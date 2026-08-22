#!/usr/bin/env node
// CERTIFICATION ROLE GRANTS. Applied through the DEPLOYED governed command, never by direct write.
//
// ============================ WHY THIS CALLS A CALLABLE ============================
//
// `roleAssignments/{uid}` is owned by trustedWriterCommands.grantRole, exposed as a deployed
// callable. That command is where two-person control on privileged Roles lives, where the
// accessVersion bump and claims sync happen, and where the audit event is written.
//
// Writing the document directly from a script would produce the same-looking data with none of it:
// no audit trail, no version bump, stale claims, and no self-escalation check. The record would be
// indistinguishable from a governed grant and would be nothing like one. So this script authenticates
// as a real principal and asks the platform, exactly as an administrator's browser would.
//
// ============================ THE PRIVILEGED GRANT IS HELD BACK ============================
//
// Exactly one of the 83 intended grants is a privileged Role: `owner`, for cw-emp-000. It is
// EXCLUDED here and reported instead.
//
// grantRole's own rule already demands a distinct approverUid and refuses self-approval for
// privileged Roles -- two-person control. An agent supplying both sides of a two-person check is not
// two-person control, it is one person typing twice. Granting the highest-privilege Role in the
// system is also precisely the action that should never be a side effect of a batch script.
//
// Run:
//   node scripts/certificationWorld/applyRoleGrants.mjs --projectId eos-platform-sandbox
//   node scripts/certificationWorld/applyRoleGrants.mjs --projectId eos-platform-sandbox --apply
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { GOVERNED_BUSINESS_ROLES: GB } = await import(L("functions/lib/access/governedBusinessRoles.js"));
const { ENVIRONMENT_ACTIVATION_REGISTRY } = await import(L("functions/lib/access/environmentCapabilityOverrides.js"));
const { loadSandboxPersona } = await import(L("scripts/sandboxCredentials.mjs"));

const REGION = "us-central1";
/** The administrator this script acts AS. A real principal, holding real authority, audited as itself. */
const ACTOR_PERSONA = "owner";

// Same strictly-stronger guard as the principal provisioner: no production, no unknown project, no
// default. This one additionally never accepts a confirmation flag, for the same reason.
function assertSandboxTarget(projectId) {
  if (!projectId) throw new Error("--projectId is required. There is no default target for granting authority.");
  const env = (ENVIRONMENT_ACTIVATION_REGISTRY.environments || []).find((e) => e?.firebase?.projectId === projectId);
  if (!env) throw new Error(`Unknown project "${projectId}" -- not in config/environments.json. Refusing.`);
  if (env.role === "production") throw new Error(`"${projectId}" is PRODUCTION. This tool never grants production authority.`);
  if (env.role !== "sandbox") throw new Error(`"${projectId}" has role "${env.role}". Sandbox only.`);
  return { projectId, role: env.role };
}

const OUTCOME = Object.freeze({
  WOULD_APPLY: "WOULD_APPLY",
  APPLIED: "APPLIED",
  ALREADY_APPLIED: "ALREADY_APPLIED",
  HELD_PRIVILEGED: "HELD_PRIVILEGED",
  BLOCKED_ROLE_NOT_DEPLOYED: "BLOCKED_ROLE_NOT_DEPLOYED",
  REFUSED: "REFUSED",
  FAILED: "FAILED",
});

async function signIn(apiKey, email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${body.error?.message}`);
  return { idToken: body.idToken, uid: body.localId };
}

async function callGrantRole(projectId, idToken, payload) {
  const res = await fetch(`https://${REGION}-${projectId}.cloudfunctions.net/grantRole`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: payload }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const apply = argv.includes("--apply");
  const keyGeneration = Number(arg("keyGeneration") ?? 1);
  const target = assertSandboxTarget(arg("projectId"));

  console.log(`certification role grants :: ${apply ? "APPLY" : "DRY RUN"} :: ${target.projectId} (role=${target.role}, keyGeneration=${keyGeneration})`);

  const cfg = JSON.parse(readFileSync(path.join(REPO, "config/environments.json"), "utf8"));
  const apiKey = cfg.environments.find((e) => e.firebase?.projectId === target.projectId).firebase.apiKey;

  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: target.projectId });
  const db = getFirestore();

  // ── Build the manifest FROM THE LIVE WORLD, not from the repository fixture.
  //
  // The fixture states intent; the sandbox states fact. Granting from the fixture would grant to
  // employees who may not exist and skip any that do, and the difference would be invisible.
  const empSnap = await db.collection("employees").get();
  const cert = empSnap.docs.filter((d) => d.id.startsWith("cw-emp-")).sort((a, b) => a.id.localeCompare(b.id));

  const manifest = [];
  for (const doc of cert) {
    const data = doc.data();
    const uid = data.userId;
    for (const roleId of data.certGovernedRoles || []) {
      const role = GB[roleId];
      manifest.push({
        employeeId: doc.id,
        uid: uid ?? null,
        roleId,
        privileged: Boolean(role?.privileged),
        displayName: data.displayName,
        outcome: null,
        detail: "",
      });
    }
  }

  const privileged = manifest.filter((m) => m.privileged);
  const grantable = manifest.filter((m) => !m.privileged);
  for (const p of privileged) {
    p.outcome = OUTCOME.HELD_PRIVILEGED;
    p.detail = "privileged Role -- requires explicit Owner authorization and a distinct second approver";
  }

  console.log(`employees with governed roles : ${new Set(manifest.map((m) => m.employeeId)).size}`);
  console.log(`total intended grants         : ${manifest.length}`);
  console.log(`grantable (non-privileged)    : ${grantable.length}`);
  console.log(`HELD (privileged)             : ${privileged.length}${privileged.length ? " -- " + privileged.map((p) => `${p.employeeId}:${p.roleId}`).join(", ") : ""}`);

  const missingUid = manifest.filter((m) => !m.uid);
  if (missingUid.length) {
    throw new Error(`${missingUid.length} intended grants have no linked principal. Run provisionPrincipals first.`);
  }

  if (!apply) {
    for (const g of grantable) g.outcome = OUTCOME.WOULD_APPLY;
    report(manifest);
    console.log("\nDRY RUN -- nothing was granted. Re-run with --apply.");
    writeManifest(manifest);
    return;
  }

  // ── Authenticate as the administrator.
  const actor = loadSandboxPersona(ACTOR_PERSONA);
  const session = await signIn(apiKey, actor.email, actor.password);
  console.log(`acting as     : ${actor.email} (uid ${session.uid.slice(0, 8)}…)`);

  let applied = 0, already = 0, failed = 0, blockedNotDeployed = 0;
  for (const g of grantable) {
    // Idempotency key is deterministic per (principal, role) so a re-run is recognisably the same
    // request rather than a new one that happens to look similar.
    //
    // UNDERSCORES, NOT COLONS. The first run rejected `certworld:cw-emp-001:generalManager` -- the
    // command accepts only letters, digits, underscore and hyphen. Worth noting that the batch
    // stopped on that first failure with ZERO applied rather than granting 81 and reporting one
    // error, which is the behaviour that makes a rejected key a five-minute fix instead of a
    // half-granted world whose capacity numbers are real and whose meaning is not.
    // KEY GENERATION. An idempotency key records the OUTCOME of a request, not just its intent, so
    // the command refuses to reuse a key that previously resolved to a DENIAL:
    //
    //   "This idempotency key has already been used for a different or denied request."
    //
    // That is the right behaviour and it caught a real case. The 16 grants blocked before the deploy
    // were denied under generation 1 ("roleId is not recognized"). Retrying them post-deploy is a
    // genuinely NEW request -- same intent, different world -- and it needs a new key. Reusing the
    // old one would ask the platform to change a recorded answer.
    //
    // Generation is explicit rather than a timestamp: a clock-based key would make every run a new
    // request and silently destroy the idempotency this whole batch depends on.
    const idempotencyKey = `certworld_g${keyGeneration}_${g.employeeId}_${g.roleId}`;

    // ALREADY_APPLIED IS DETECTED BEFORE CALLING, not inferred from the response.
    //
    // The command is genuinely idempotent -- a verified re-run created 0 new assignment documents,
    // moved 0 grantedAt timestamps and caused 0 accessVersion churn -- but it returns plain success
    // for a no-op, with no flag distinguishing "created" from "already there". Reading the response
    // therefore reported 66 APPLIED on a run that applied nothing, which is a reporting defect: the
    // second-run evidence the whole idempotency check depends on would have been a false positive.
    //
    // Asking Firestore first is both accurate and cheaper than a redundant governed write.
    const existingAssignment = await db.collection("roleAssignments")
      .where("principalUid", "==", g.uid)
      .where("roleId", "==", g.roleId)
      .where("status", "==", "active")
      .limit(1)
      .get();
    if (!existingAssignment.empty) {
      g.outcome = OUTCOME.ALREADY_APPLIED;
      g.detail = `active assignment ${existingAssignment.docs[0].id} already present`;
      already += 1;
      continue;
    }
    const result = await callGrantRole(target.projectId, session.idToken, {
      principalUid: g.uid,
      roleId: g.roleId,
      scope: { type: "global" },
      idempotencyKey,
    });

    const msg = result.body?.error?.message || "";

    // A 503 "recorded, retry with the same idempotency key" is NOT a failure. The assignment write
    // succeeded and a follow-up step (claims sync) is still completing; the command is telling us to
    // confirm with the same key. Treating it as failure would abort a batch that is working;
    // treating it as success would report a grant whose follow-up may never have landed.
    if (!result.ok && /still completing/i.test(msg)) {
      let confirmed = false;
      for (let attempt = 0; attempt < 4 && !confirmed; attempt += 1) {
        await new Promise((r) => setTimeout(r, 1500));
        const retry = await callGrantRole(target.projectId, session.idToken, {
          principalUid: g.uid, roleId: g.roleId, scope: { type: "global" }, idempotencyKey,
        });
        if (retry.ok) confirmed = true;
        else if (!/still completing/i.test(retry.body?.error?.message || "")) break;
      }
      if (confirmed) {
        g.outcome = OUTCOME.APPLIED;
        g.detail = "recorded, confirmed on retry with the same idempotency key";
        applied += 1;
        continue;
      }
    }

    // AN EXPLAINED REFUSAL IS NOT AN UNEXPLAINED FAILURE. The deployed build predates the five Roles
    // added in PR #1401, so grantRole legitimately does not recognise them. That is a DEPLOY gap, not
    // a governance gap, and it is recorded per-grant rather than aborting the 66 grants that are
    // applicable today -- stopping here would block all of them on a Functions deploy.
    if (!result.ok && /roleId is not recognized/i.test(msg)) {
      g.outcome = OUTCOME.BLOCKED_ROLE_NOT_DEPLOYED;
      g.detail = "the deployed grantRole build does not know this Role; requires a Functions deploy";
      blockedNotDeployed += 1;
      continue;
    }

    if (result.ok) {
      const already_ = result.body?.result?.alreadyApplied ?? result.body?.result?.idempotent ?? false;
      g.outcome = already_ ? OUTCOME.ALREADY_APPLIED : OUTCOME.APPLIED;
      if (already_) already += 1; else applied += 1;
    } else {
      g.outcome = OUTCOME.FAILED;
      g.detail = msg || `HTTP ${result.status}`;
      failed += 1;
      // STOP on the first unexplained failure. Continuing through a partial batch produces a
      // half-granted world whose capacity numbers are real and whose meaning is not.
      console.error(`\nFAILED at ${g.employeeId} / ${g.roleId}: ${msg}`);
      console.error("Refusing to continue through a partially applied batch.");
      break;
    }
  }

  console.log(`\napplied: ${applied} | alreadyApplied: ${already} | blockedNotDeployed: ${blockedNotDeployed} | failed: ${failed}`);
  report(manifest);
  writeManifest(manifest);
  if (failed) process.exitCode = 1;
}

function report(manifest) {
  const tally = manifest.reduce((m, g) => { m[g.outcome] = (m[g.outcome] || 0) + 1; return m; }, {});
  console.log("outcomes:", JSON.stringify(tally));
  const problems = manifest.filter((g) => g.outcome === OUTCOME.FAILED || g.outcome === OUTCOME.REFUSED);
  for (const p of problems) console.log("  ", p.outcome, p.employeeId, p.roleId, p.detail);
}

function writeManifest(manifest) {
  const out = path.join(REPO, "docs/governance/certification-grant-manifest.json");
  writeFileSync(out, JSON.stringify({
    generatedFrom: "live sandbox employees collection, not the repository fixture",
    totalIntended: manifest.length,
    grantable: manifest.filter((m) => !m.privileged).length,
    heldPrivileged: manifest.filter((m) => m.privileged).map((m) => ({ employeeId: m.employeeId, roleId: m.roleId, why: m.detail })),
    grants: manifest,
  }, null, 1));
  console.log("manifest written:", path.relative(REPO, out));
}

main().catch((err) => {
  console.error("REFUSED:", err.message);
  process.exitCode = 1;
});
