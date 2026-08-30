#!/usr/bin/env node
// CERTIFICATION AUTH PRINCIPALS. Real Firebase Auth identities for the 47 synthetic employees.
//
// ============================ IDENTITY IS NOT DATA ============================
//
// The Certification World can be reset, rebuilt and re-versioned. The identities must not move when
// it is. So the two live in different layers on purpose:
//
//   Firebase Auth      the PRINCIPAL. Durable. Never touched by a world reset or a sandbox refresh.
//   Firestore employee the RECORD. Disposable, rebuilt from the repository.
//   employee.userId    the LINK, re-established at seed time from the stable email.
//
// This is the correction that made the work possible at all: the 47 employees existed only as
// Firestore fixture data, and a governed Role grant is a `roleAssignments/{uid}` write against an
// AUTH identity. Forty-seven records with no principal are forty-seven people who cannot be granted
// anything, which is why the grant phase was blocked.
//
// ============================ THE STABLE BRIDGE IS THE EMPLOYEE ID ============================
//
// The synthetic login is derived from `cw-emp-NNN`, never from a display name. Renaming
// "Jordan Smith" to "Jordan Rivera" must not create a second principal, orphan a UID, or break the
// audit lineage -- and because the name is not an input to the identity key, it cannot.
//
// PASSWORDLESS BY DEFAULT. These accounts are created with no credential material whatsoever. The
// governed provisioning path already works this way, and it means this script generates no secret,
// prints no secret, and stores no secret. Interactive login is a SEPARATE, explicit activation for
// the few personas that need to sign in -- identity never depends on a password.
//
// Run -- DRY RUN (reads and reports; needs no live-write authorization):
//   node scripts/certificationWorld/provisionPrincipals.mjs --projectId eos-platform-certification
//
// Run -- LIVE identity creation. Each target has its OWN flag, and BOTH words are required:
//   node scripts/certificationWorld/provisionPrincipals.mjs \
//        --projectId eos-platform-certification --apply --apply-live-certification
//   node scripts/certificationWorld/provisionPrincipals.mjs \
//        --projectId eos-platform-sandbox --apply --apply-live-sandbox
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { buildWorkforce, functionLabelFor } = await import(L("functions/scripts/certificationWorld/data/workforce.mjs"));

// ============================ THE IDENTITY NAMESPACE ============================
//
// Deliberately NOT `@sandbox.invalid`, which the 8 existing personas use and which
// activateSandboxPersonas.js filters on with a literal `@sandbox.invalid` suffix test.
//
// `cw-emp-000@eos-sandbox.invalid` does not end with `@sandbox.invalid` (the character before
// "sandbox" is a hyphen), so persona rotation structurally CANNOT touch these 47 -- verified, not
// assumed. The namespace choice buys that isolation for free, and it means a future `--rotate` of
// the Owner's personas cannot invalidate the certification identities as a side effect.
const CERT_EMAIL_DOMAIN = "@eos-sandbox.invalid";
const emailFor = (employeeId) => `${employeeId}${CERT_EMAIL_DOMAIN}`;

const EMPLOYEES_COLLECTION = "employees";
const USERS_COLLECTION = "users";

// ============================ TARGET AUTHORITY ============================
//
// This file used to carry its own `assertSandboxTarget`: production refused, unknown projects
// refused, registry role must be exactly "sandbox". Strictly stronger than the governed staff
// provisioning tool, and correct as far as it went -- for exactly as long as there was one
// sandbox-role environment.
//
// eos-platform-certification is ALSO role "sandbox". Under a role-only guard the command that
// mints 47 identities in the sandbox becomes the command that mints them in certification by
// editing one word, and nothing on the line names which project is about to gain principals.
// That is the same gap #1604 closed for the world installer, and identity is the layer the world
// installer explicitly does NOT own -- principals survive a world reset, so a mistake here is not
// undone by rebuilding anything.
//
// So the local guard is GONE, not kept beside the shared one. Two guards that can disagree are
// one guard plus a weaker one an operator can reach, and a parallel path that can authorize a
// write independently is exactly what "route through the shared authority" has to mean.
const { resolveExecutionTarget, LIVE_TARGET_FLAGS_BY_PROJECT, assertBothLiveFlags, describeTarget } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));

/**
 * Decide whether THIS invocation may create or link identities, and against what. PURE: parses,
 * adjudicates, throws. No Firebase app, no Auth client, no Firestore -- which is what lets the
 * test suite drive the real CLI contract instead of asserting against resolveExecutionTarget in
 * isolation and hoping this file still calls it.
 *
 * ============================ THE RULES ============================
 *
 * A DRY RUN needs no live-write authorization. It reads to report what WOULD happen, and demanding
 * --apply-live-certification for it would train an operator to type the live flag for a command
 * that writes nothing -- which is how the flag stops meaning anything.
 *
 * A LIVE RUN requires BOTH --apply and the target's own named flag, matching certificationWorld.mjs
 * rather than executionTarget's looser default (which treats the named flag as implying --apply).
 * Creating 47 durable Auth principals is not a handful of records, and the two words are
 * independent: one says "not a dry run", the other says WHICH project.
 *
 * --activate-logins IS NOT AUTHORIZATION AND CANNOT SUBSTITUTE FOR ANY OF IT. It is a strictly
 * narrower question asked after the target is already settled -- may these principals also receive
 * an interactive credential -- and it is deliberately absent from every branch below. It already
 * requires --apply on its own account; that is an additional condition, never an alternative one.
 */
export function authorizeProvisioning(argv) {
  // --projectId is read by resolveExecutionTarget from argv itself. Parsing it here as well would
  // be a second copy of the rule, and the copy is what drifts out of step.
  const apply = argv.includes("--apply");
  const activate = argv.includes("--activate-logins");

  // Production by name AND by role, unknown projects, a missing --projectId, and ambient
  // credentials that disagree with the stated target are all refused in here, once.
  const target = resolveExecutionTarget({
    argv: ["node", "provisionPrincipals.mjs", ...argv],
    writes: apply,
  });

  // The BOTH-flags rule is shared with every other heavy writer, in executionTarget.mjs. It was
  // written by hand here and in certificationWorld.mjs before three more tools needed it; five
  // copies of a safety rule is four chances for one of them to be subtly different.
  if (apply) assertBothLiveFlags({ target, argv, act: "Creating identities in" });

  // The named flag alone must not be a live run. executionTarget infers --apply from it; this tool
  // does not, so the operator has to have typed both words.
  if (!apply && target.isLive) {
    const liveFlag = LIVE_TARGET_FLAGS_BY_PROJECT.get(target.projectId) ?? null;
    if (liveFlag && argv.includes(liveFlag)) {
      throw new Error(
        `${liveFlag} was given without --apply. This tool requires both for a live run; pass --apply `
        + "as well, or drop the live flag to perform a dry run.");
    }
  }

  return { target, apply, activate };
}

const OUTCOME = Object.freeze({
  WOULD_CREATE: "WOULD_CREATE",
  CREATED: "CREATED",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  WOULD_LINK: "WOULD_LINK",
  LINKED: "LINKED",
  ALREADY_LINKED: "ALREADY_LINKED",
  LINK_PENDING_WORLD_SEED: "LINK_PENDING_WORLD_SEED",
  REFUSED_AMBIGUOUS: "REFUSED_AMBIGUOUS",
  FAILED: "FAILED",
});

// ============================ INTERACTIVE LOGIN ACTIVATION ============================
//
// Separate flag, separate step, and deliberately NOT part of --apply. Creating an identity and
// issuing a credential are different acts with different blast radii: the first is reversible and
// harmless, the second puts a working password into a file on someone's disk.
//
// SEMANTICS COPIED FROM activateSandboxPersonas.js --activate-missing, because that script already
// learned this lesson the hard way: it used to rotate every persona on every run and describe that
// as safe, which twice invalidated the Owner's saved copy and surfaced as "invalid password" --
// sending whoever ran it to debug entirely the wrong thing.
//
// So: MERGE, never replace. Set a password ONLY where none is recorded. Never touch an entry that
// already works, and never touch the 13 existing @sandbox.invalid personas at all -- they are a
// different namespace and this tool has no business in it.
//
// The generated value is written to the gitignored credentials file and NOWHERE else: not printed,
// not logged, not returned, not committed. The operator can reset any of them later by removing the
// entry and re-running with --activate-logins.
async function activateLogins(auth, rows) {
  const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
  const { randomBytes } = await import("node:crypto");
  const { candidatePaths } = await import(L("scripts/sandboxCredentials.mjs"));

  const filePath = candidatePaths().find(existsSync);
  if (!filePath) {
    throw new Error("CREDENTIAL_ACCESS_FAILED: no sandbox credentials file found. Refusing to create one from nothing.");
  }
  const existing = JSON.parse(readFileSync(filePath, "utf8"));
  const before = Object.keys(existing).length;

  // A 24-byte url-safe secret. Not derived from the employee id, the name, or anything else
  // guessable -- a deterministic sandbox password is a published password.
  const newSecret = () => randomBytes(24).toString("base64url");

  let activated = 0;
  let alreadyHadCredential = 0;
  for (const row of rows) {
    if (!row.uid) continue;
    if (existing[row.email]) { alreadyHadCredential += 1; row.interactiveLoginRequired = true; continue; }
    const secret = newSecret();
    await auth.updateUser(row.uid, { password: secret });
    existing[row.email] = secret;
    row.interactiveLoginRequired = true;
    activated += 1;
  }

  // Written back as a MERGE of the original object, so every pre-existing persona key survives
  // byte-for-byte. Asserted rather than assumed, because "I merged" is exactly the kind of claim
  // that is true right up until someone reorders an assignment.
  const after = Object.keys(existing).length;
  if (after < before) {
    throw new Error(`REFUSING to write: entry count fell ${before} -> ${after}. That is a replace, not a merge.`);
  }
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n", "utf8");
  return { filePath, before, after, activated, alreadyHadCredential };
}

async function main() {
  const argv = process.argv.slice(2);
  // AUTHORIZE BEFORE ANYTHING INITIALIZES. This runs ahead of initializeApp/getAuth, so a refused
  // invocation never opens an Auth client against the project it was refused for.
  const { target, apply, activate } = authorizeProvisioning(argv);

  console.log(`certification principals :: ${apply ? "APPLY" : "DRY RUN"} :: ${target.projectId} (role=${target.role})`);
  console.log(describeTarget(target));
  console.log(`identity namespace: *${CERT_EMAIL_DOMAIN}`);

  if (!getApps().length) {
    initializeApp({ credential: applicationDefault(), projectId: target.projectId });
  }
  const auth = getAuth();
  const db = getFirestore();

  const employees = buildWorkforce();
  const rows = [];

  for (const e of employees) {
    const email = emailFor(e.employeeId);
    // Role first, so a sorted Auth console groups by function. Derived every run, so a role change
    // updates the display name and touches nothing else -- no new principal, same UID.
    //
    // The label goes in the DISPLAY NAME, never the login: role assignments change, and an email
    // like `partsassoc-01@` would be a fact that expires. A display name is free to be corrected;
    // a UID is not.
    const authDisplayName = `${functionLabelFor(e)} -- ${e.displayName} (${e.employeeId})`;
    const row = {
      employeeId: e.employeeId,
      email,
      displayName: e.displayName,
      businessRoles: (e.certGovernedRoles || []).filter((r) => !r.startsWith("inventory") && !r.startsWith("report") && !r.startsWith("crm") && !r.startsWith("workOrder") && !r.startsWith("equipment")),
      functionalRoles: (e.certGovernedRoles || []).filter((r) => r.startsWith("inventory") || r.startsWith("report") || r.startsWith("crm") || r.startsWith("workOrder") || r.startsWith("equipment")),
      // Interactive login is the EXCEPTION. Most certification employees exist to be granted
      // authority and measured, not to sign in; only the personas an operator actually drives need
      // a credential, and that is a separate explicit activation.
      interactiveLoginRequired: false,
      uid: null,
      authOutcome: null,
      linkOutcome: null,
      note: "",
    };

    // ── Resolve the principal
    let existing = null;
    try {
      existing = await auth.getUserByEmail(email);
    } catch (err) {
      if (err?.code !== "auth/user-not-found") {
        row.authOutcome = OUTCOME.FAILED;
        row.note = err?.code || String(err);
        rows.push(row);
        continue;
      }
    }

    if (existing) {
      row.uid = existing.uid;
      row.authOutcome = OUTCOME.ALREADY_EXISTS;
      // A stale display name is corrected IN PLACE. This is the rename case the whole design exists
      // for: the label changes, the UID does not, and nothing downstream notices.
      if (apply && existing.displayName !== authDisplayName) {
        await auth.updateUser(existing.uid, { displayName: authDisplayName });
        row.note = "display name updated (uid unchanged)";
      }
    } else if (!apply) {
      row.authOutcome = OUTCOME.WOULD_CREATE;
    } else {
      try {
        // PASSWORDLESS. No `password` field is passed, so no credential material is generated,
        // printed or stored anywhere by this script.
        const created = await auth.createUser({
          email,
          displayName: authDisplayName,
          emailVerified: false,
          disabled: false,
        });
        row.uid = created.uid;
        row.authOutcome = OUTCOME.CREATED;
      } catch (err) {
        row.authOutcome = OUTCOME.FAILED;
        row.note = err?.code || String(err);
        rows.push(row);
        continue;
      }
    }

    // ── Reconcile the link, FAIL CLOSED on any ambiguity
    const empRef = db.collection(EMPLOYEES_COLLECTION).doc(e.employeeId);
    const empSnap = await empRef.get();

    if (!empSnap.exists) {
      // The world is not seeded. The principal is still durable and correct; the link is written
      // when the world is built. Reported rather than papered over.
      row.linkOutcome = OUTCOME.LINK_PENDING_WORLD_SEED;
      rows.push(row);
      continue;
    }

    const currentUserId = empSnap.data()?.userId ?? null;
    if (currentUserId && row.uid && currentUserId !== row.uid) {
      // An employee pointing at a DIFFERENT principal than its deterministic email resolves to.
      // Never auto-repaired: one of the two is wrong and this script cannot know which, and
      // guessing would either orphan a real principal or silently re-point an audit lineage.
      row.linkOutcome = OUTCOME.REFUSED_AMBIGUOUS;
      row.note = `employee.userId=${currentUserId} but ${email} resolves to ${row.uid}`;
      rows.push(row);
      continue;
    }

    // And the reverse direction: a principal already claimed by a different employee.
    if (row.uid) {
      const userSnap = await db.collection(USERS_COLLECTION).doc(row.uid).get();
      const claimedBy = userSnap.exists ? userSnap.data()?.employeeId ?? null : null;
      if (claimedBy && claimedBy !== e.employeeId) {
        row.linkOutcome = OUTCOME.REFUSED_AMBIGUOUS;
        row.note = `uid ${row.uid} already claims employeeId=${claimedBy}`;
        rows.push(row);
        continue;
      }
    }

    if (currentUserId && currentUserId === row.uid) {
      row.linkOutcome = OUTCOME.ALREADY_LINKED;
    } else if (!apply) {
      row.linkOutcome = OUTCOME.WOULD_LINK;
    } else {
      // Both sides of the bidirectional link, in one batch, matching the governed provisioning
      // tool's own contract: employees/{id}.userId <-> users/{uid}.employeeId.
      const batch = db.batch();
      batch.set(empRef, { userId: row.uid }, { merge: true });
      batch.set(db.collection(USERS_COLLECTION).doc(row.uid), { employeeId: e.employeeId }, { merge: true });
      await batch.commit();
      row.linkOutcome = OUTCOME.LINKED;
    }
    rows.push(row);
  }

  // ── Interactive login activation, only when explicitly asked for
  let activation = null;
  if (activate) {
    if (!apply) {
      console.log("");
      console.log("--activate-logins requires --apply (it writes real credentials). Nothing done.");
    } else {
      activation = await activateLogins(auth, rows);
    }
  }

  // ── Report
  const tally = (key) => rows.reduce((m, r) => { const v = r[key]; if (v) m[v] = (m[v] || 0) + 1; return m; }, {});
  const uids = rows.map((r) => r.uid).filter(Boolean);
  const emails = rows.map((r) => r.email);

  console.log("");
  console.log("employees processed :", rows.length);
  console.log("auth outcomes       :", JSON.stringify(tally("authOutcome")));
  console.log("link outcomes       :", JSON.stringify(tally("linkOutcome")));
  console.log("unique UIDs         :", new Set(uids).size, "of", uids.length);
  console.log("unique emails       :", new Set(emails).size, "of", emails.length);

  const problems = rows.filter((r) => r.authOutcome === OUTCOME.FAILED || r.linkOutcome === OUTCOME.REFUSED_AMBIGUOUS);
  if (problems.length) {
    console.log("");
    console.log("REFUSED / FAILED:", problems.length);
    for (const p of problems) console.log("  ", p.employeeId, p.authOutcome, p.linkOutcome, p.note);
  }

  // Anything in the certification namespace that is NOT one of the 47 is unexpected and is
  // reported, never deleted -- this script has no delete path at all.
  const expectedEmails = new Set(emails);
  const strangers = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      if (u.email && u.email.endsWith(CERT_EMAIL_DOMAIN) && !expectedEmails.has(u.email)) {
        strangers.push(u.email);
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  console.log("unexpected principals in namespace:", strangers.length, strangers.slice(0, 5).join(", "));

  if (activation) {
    console.log("");
    console.log("credential file      :", activation.filePath);
    console.log("entries before/after :", activation.before, "->", activation.after);
    console.log("logins activated     :", activation.activated);
    console.log("already had one      :", activation.alreadyHadCredential, "(left untouched)");
    console.log("NOTE: passwords are written ONLY to the gitignored credentials file. Never printed here.");
  }

  console.log("");
  console.log(apply ? "APPLIED." : "DRY RUN -- nothing was written. Re-run with --apply.");
  return rows;
}

// RUN ONLY WHEN INVOKED DIRECTLY.
//
// authorizeProvisioning() above is imported by its test -- the guard that this tool actually
// consults the shared execution authority rather than merely living next to it. An unguarded
// main() runs the entire tool on import: it demands --projectId, refuses, and sets a non-zero exit
// code on the test process. A script whose authorization decision cannot be imported without
// executing the script is a decision that does not get tested.
const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error("REFUSED:", err.message);
    process.exitCode = 1;
  });
}
