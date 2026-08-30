/**
 * EOS Ownership Model v1 — the SANDBOX OWNERSHIP BACKFILL APPLIER.
 *
 * Owner-authorized 2026-08-30 for `eos-platform-sandbox` ONLY, for exactly the 1,015 documents
 * proven by the final simulation.
 *
 * ============================ SAFETY, IN THE ORDER IT IS ENFORCED ============================
 *
 *   DRY RUN BY DEFAULT.        Writes only with --apply.
 *   EXPLICIT TARGET.           --projectId required. No default project anywhere in this file.
 *   HARD PRODUCTION REFUSAL.   `taylor-parts` by name; any registry role other than `sandbox`;
 *                              an unknown project; a project with no registry role. All fail closed.
 *   DELIBERATE CONFIRMATION.   --apply additionally requires
 *                              --confirm-sandbox-ownership-backfill. Two flags, so no single
 *                              mistyped word can start a write.
 *   RECOMPUTED, NEVER REPLAYED. Every candidate is derived from CURRENT data through
 *                              lib/ownership/ownershipBackfillRules.js -- the same module the
 *                              simulation used. No simulation output is read as instructions.
 *   CAPPED.                    Per-collection authorized maxima. Any excess STOPS the run before
 *                              a single write.
 *   NEVER OVERWRITES.          A record whose ownership field is already present is ALREADY_SET and
 *                              is skipped. Enforced twice: in the rule, and again at write time.
 *   FIELD-SCOPED.              Only the fields a rule declares are written, via merge. Nothing else
 *                              on the document is touched.
 *   FAILS CLOSED.              An unexpected shape, an unknown outcome kind, or a patch containing
 *                              a field the rule did not declare aborts the run.
 *   IDEMPOTENT.                A second run writes 0. That is asserted by re-running, not assumed.
 *
 * Usage:
 *   node scripts/ownershipSandboxBackfill.js --projectId eos-platform-sandbox
 *   node scripts/ownershipSandboxBackfill.js --projectId eos-platform-sandbox --apply --confirm-sandbox-ownership-backfill
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("node:fs");
const path = require("node:path");

const { resolveOperatingCompany } = require("../lib/ownership/operatingCompanyAuthority.js");
const {
  BACKFILL_RULES,
  AUTHORIZED_WRITE_CAPS,
  AUTHORIZED_TOTAL,
} = require("../lib/ownership/ownershipBackfillRules.js");

const ROOT_CONFIG = path.resolve(__dirname, "../../config/ownership/operating-company-roots.sandbox.json");
const CONFIRM_FLAG = "confirm-sandbox-ownership-backfill";
const BATCH_SIZE = 400;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
    }
  }
  return out;
}

/** Sandbox or nothing. Every branch here is a refusal; the only way out is an explicit sandbox role. */
function assertSandboxTarget(projectId) {
  if (!projectId || projectId === "true") throw new Error("--projectId is required. There is no default target.");
  if (projectId === "taylor-parts") throw new Error("REFUSING: taylor-parts is the customer production project.");
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const env = registry.environments.find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) throw new Error(`REFUSING: '${projectId}' is not a known provisioned environment. Unknown projects fail closed.`);
  if (!env.role) throw new Error(`REFUSING: environment '${env.id}' has no registry role. A missing role fails closed.`);
  if (env.role !== "sandbox") throw new Error(`REFUSING: environment '${env.id}' has role '${env.role}', not 'sandbox'.`);
  return env;
}

function loadRootCompanies() {
  const cfg = JSON.parse(fs.readFileSync(ROOT_CONFIG, "utf8"));
  const map = new Map();
  for (const group of Object.values(cfg.roots)) {
    for (const row of group) {
      if (row.operatingCompanyId === null || row.operatingCompanyId === undefined) continue;
      if (resolveOperatingCompany(row.operatingCompanyId).state !== "RESOLVED") {
        throw new Error(`REFUSING: root ${row.id} names an ungoverned company: ${row.operatingCompanyId}`);
      }
      map.set(row.id, row.operatingCompanyId);
    }
  }
  return map;
}

async function buildContext(db) {
  const accountOwnerByAccountId = new Map();
  for (const doc of (await db.collection("accounts").get()).docs) {
    const id = doc.data()?.accountOwner?.assignedToEmployeeId;
    if (typeof id === "string" && id.trim().length > 0) accountOwnerByAccountId.set(doc.id, id.trim());
  }
  const { fleetOperatingCompany } = await import("./certificationWorld/data/equipmentAssets.mjs");
  const { serviceJobOperatingCompany } = await import("./certificationWorld/data/serviceJobCompany.mjs");

  return {
    accountOwnerByAccountId,
    rootCompanyById: loadRootCompanies(),
    // The fixture id carries the fleet index. A record whose id does not match the fixture shape
    // returns null and is protected rather than guessed at.
    equipmentFleetCompany: (equipmentId) => {
      const m = /^cw-eq-(\d+)-\d+$/.exec(equipmentId);
      return m ? fleetOperatingCompany(Number.parseInt(m[1], 10)) : null;
    },
    serviceJobCompany: (jobId) => serviceJobOperatingCompany(jobId),
  };
}

/** Every value a patch may carry must be a governed company id or a typed USER owner. Nothing else. */
function assertPatchIsGoverned(rule, docId, patch) {
  const declared = new Set(rule.fields);
  for (const [field, value] of Object.entries(patch)) {
    if (!declared.has(field)) {
      throw new Error(`FAIL CLOSED: ${rule.collection}/${docId} patch writes undeclared field "${field}"`);
    }
    if (field === "owner") {
      const ok = value && typeof value === "object" && value.type === "USER" && typeof value.id === "string" && value.id.length > 0 && Object.keys(value).length === 2;
      if (!ok) throw new Error(`FAIL CLOSED: ${rule.collection}/${docId} owner patch is not a typed USER owner`);
      continue;
    }
    if (resolveOperatingCompany(value).state !== "RESOLVED") {
      throw new Error(`FAIL CLOSED: ${rule.collection}/${docId} field ${field} is not a governed company: ${String(value)}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = assertSandboxTarget(args.projectId);
  const apply = args.apply === "true";
  if (apply && args[CONFIRM_FLAG] !== "true") {
    throw new Error(`REFUSING: --apply also requires --${CONFIRM_FLAG}. Two deliberate flags, on purpose.`);
  }

  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();
  const ctx = await buildContext(db);

  console.log(`Ownership sandbox backfill — ${env.id} (${args.projectId}), role=${env.role}`);
  console.log(apply ? "MODE: APPLY (confirmed)\n" : "MODE: DRY RUN — nothing will be written\n");
  console.log(`Authored physical roots: ${ctx.rootCompanyById.size} | accounts with an owner: ${ctx.accountOwnerByAccountId.size}\n`);

  // ---------------- pass 1: recompute every candidate from CURRENT data
  const plan = [];
  for (const rule of BACKFILL_RULES) {
    const snap = await db.collection(rule.collection).get();
    const row = { collection: rule.collection, scanned: snap.size, eligible: [], alreadyCorrect: 0, protectedBy: {}, refused: 0, notes: {} };
    for (const doc of snap.docs) {
      const outcome = rule.evaluate({ id: doc.id, data: doc.data() }, ctx);
      if (outcome.kind === "ALREADY_SET") { row.alreadyCorrect += 1; continue; }
      if (outcome.kind === "PROTECTED") { row.protectedBy[outcome.reason] = (row.protectedBy[outcome.reason] ?? 0) + 1; continue; }
      if (outcome.kind !== "WRITE") throw new Error(`FAIL CLOSED: unknown outcome kind for ${rule.collection}/${doc.id}`);
      assertPatchIsGoverned(rule, doc.id, outcome.patch);
      if (outcome.note) row.notes[outcome.note] = (row.notes[outcome.note] ?? 0) + 1;
      row.eligible.push({ id: doc.id, patch: outcome.patch });
    }
    plan.push({ rule, ...row });
  }

  // ---------------- the cap check, BEFORE any write
  const excess = plan.filter((p) => p.eligible.length > (AUTHORIZED_WRITE_CAPS[p.collection] ?? 0));
  const total = plan.reduce((n, p) => n + p.eligible.length, 0);

  const header = "collection".padEnd(26) + "scanned".padStart(8) + "eligible".padStart(9) + "cap".padStart(6) + "already".padStart(9) + "protected".padStart(11);
  console.log(header);
  console.log("-".repeat(header.length));
  for (const p of plan) {
    const prot = Object.values(p.protectedBy).reduce((a, b) => a + b, 0);
    console.log(
      p.collection.padEnd(26) +
        String(p.scanned).padStart(8) +
        String(p.eligible.length).padStart(9) +
        String(AUTHORIZED_WRITE_CAPS[p.collection] ?? 0).padStart(6) +
        String(p.alreadyCorrect).padStart(9) +
        String(prot).padStart(11),
    );
  }
  console.log("-".repeat(header.length));
  console.log("TOTAL".padEnd(26) + "".padStart(8) + String(total).padStart(9) + String(AUTHORIZED_TOTAL).padStart(6));

  console.log("\nProtected, by reason:");
  let anyProtected = false;
  for (const p of plan) {
    for (const [reason, n] of Object.entries(p.protectedBy).sort((a, b) => b[1] - a[1])) {
      anyProtected = true;
      console.log(`  ${String(n).padStart(5)}  ${p.collection}: ${reason}`);
    }
  }
  if (!anyProtected) console.log("  (none)");

  const noted = plan.filter((p) => Object.keys(p.notes).length > 0);
  if (noted.length > 0) {
    console.log("\nShape detail:");
    for (const p of noted) for (const [note, n] of Object.entries(p.notes)) console.log(`  ${String(n).padStart(5)}  ${p.collection}: ${note}`);
  }

  if (excess.length > 0) {
    console.error("\nSTOP: recomputed candidates EXCEED the authorized maximum:");
    for (const p of excess) console.error(`  ${p.collection}: ${p.eligible.length} > ${AUTHORIZED_WRITE_CAPS[p.collection]}`);
    console.error("No document was written. Report the delta before proceeding.");
    process.exit(2);
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing was written. ${total} document(s) are eligible (authorized ${AUTHORIZED_TOTAL}).`);
    if (total !== AUTHORIZED_TOTAL) {
      console.log(`NOTE: eligible (${total}) differs from the authorized total (${AUTHORIZED_TOTAL}). Investigate before applying.`);
    }
    writeEvidence(args.projectId, plan, false, 0);
    return;
  }

  // ---------------- pass 2: write, re-reading each document inside a transaction
  let written = 0;
  let refused = 0;
  for (const p of plan) {
    for (let i = 0; i < p.eligible.length; i += BATCH_SIZE) {
      const slice = p.eligible.slice(i, i + BATCH_SIZE);
      await db.runTransaction(async (tx) => {
        const refs = slice.map((c) => db.collection(p.collection).doc(c.id));
        const snaps = await Promise.all(refs.map((r) => tx.get(r)));
        const stage = [];
        snaps.forEach((snap, n) => {
          if (!snap.exists) { refused += 1; return; }
          const current = snap.data() ?? {};
          // SECOND overwrite guard, at write time. The eligibility read and this read are different
          // moments, and something else may have set the field in between.
          for (const field of Object.keys(slice[n].patch)) {
            if (current[field] !== undefined) { refused += 1; return; }
          }
          stage.push([refs[n], slice[n].patch]);
        });
        for (const [ref, patch] of stage) tx.set(ref, patch, { merge: true });
        written += stage.length;
      });
    }
  }

  console.log(`\nAPPLIED: ${written} document(s) written. ${refused} refused at write time (already set or missing).`);
  writeEvidence(args.projectId, plan, true, written);
  console.log("Re-run WITHOUT --apply to confirm 0 remain eligible.");
}

function writeEvidence(projectId, plan, applied, written) {
  const evidence = {
    projectId,
    applied,
    written,
    authorizedTotal: AUTHORIZED_TOTAL,
    collections: plan.map((p) => ({
      collection: p.collection,
      scanned: p.scanned,
      eligible: p.eligible.length,
      authorizedCap: AUTHORIZED_WRITE_CAPS[p.collection] ?? 0,
      alreadyCorrect: p.alreadyCorrect,
      protectedBy: p.protectedBy,
      notes: p.notes,
      // Ids are recorded so the applied set is auditable document-for-document.
      eligibleIds: p.eligible.map((e) => e.id),
    })),
  };
  const out = path.resolve(__dirname, `../../sb-evidence/ownership-backfill-${applied ? "applied" : "dryrun"}-${projectId}.json`);
  fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Evidence: ${out}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
