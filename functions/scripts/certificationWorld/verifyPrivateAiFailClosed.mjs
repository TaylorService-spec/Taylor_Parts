#!/usr/bin/env node
// PRIVATE-AI FAIL-CLOSED — LIVE CERTIFICATION VERIFICATION.
//
//   node scripts/certificationWorld/verifyPrivateAiFailClosed.mjs --projectId eos-platform-certification
//
// The deterministic half of this contract is test/certificationPrivateAiFailClosed.test.mjs, which
// runs in ordinary CI with no network. THIS command is the explicit certification step: it asks the
// DEPLOYED project the same questions, so it needs Application Default Credentials with read access
// and is run during certification and security reviews, never wired into PR CI.
//
// WHAT IT PROVES, in order — and the order is the argument:
//
//   1. The seeded Certification World EXISTS and matches the repository expectation exactly
//      (record count, fingerprint, per-collection counts, 47 employee->principal links).
//   2. The registry posture for this project still refuses model interpretation.
//   3. The deployed interpretation callable still refuses — with data provably present, which is
//      the whole point: DATA PRESENT != AI AUTHORITY.
//
// READ ONLY. Issues reads and one callable invocation whose only tested behaviour is refusal.
// Writes nothing, deploys nothing, changes no Rules, grants, flags, or data.
//
// The authenticated probe is OPTIONAL because it needs a certification principal's password:
//   CERT_AI_PROBE_EMAIL / CERT_AI_PROBE_PASSWORD  (never printed; sourced by the operator)
// Without them the command still proves 1–2 plus that the callable refuses unauthenticated
// callers, and reports the authenticated refusal as SKIPPED rather than silently passing.
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { expectedRecords } = await import(L("functions/scripts/certificationWorld.mjs"));
const { worldFingerprint } = await import(L("functions/scripts/certificationWorld/state.mjs"));
const { MARKER_FIELD } = await import(L("functions/scripts/certificationWorld/manifest.mjs"));
const { STATE_COLLECTION, STATE_DOC_ID } = await import(L("functions/scripts/certificationWorld/state.mjs"));
const { ENVIRONMENT_ACTIVATION_REGISTRY, resolveSyntheticOperationalInterpretation } =
  await import(L("functions/lib/access/environmentCapabilityOverrides.js"));
const { resolveReadOnlyTarget, describeTarget } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));

const EXPECTED_LINKED_EMPLOYEES = 47;
const EXACT_REFUSAL = { speak: false, origin: "EOS", reason: "INTERPRETATION_NOT_PERMITTED_HERE" };

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

// TARGET AUTHORITY. This is a READ-ONLY verifier -- it invokes the private-AI callable, which
// refuses before provider resolution and writes nothing -- so it needs no live-write flag. It still
// belongs under the shared authority: its own guard refused production and unknown projects but,
// like every other local guard, could not distinguish the two sandbox-role worlds. A verifier
// pointed at the wrong world reports a PASS about a project nobody asked about, which is a quieter
// failure than a misdirected write and no less misleading.
//
// resolveReadOnlyTarget refuses production by name AND by role, unknown projects, a missing
// --projectId, and ambient credentials that disagree -- without demanding a live-write flag for a
// command that only reads.
export function authorizeVerification(args = argv) {
  return resolveReadOnlyTarget({ argv: ["node", "verifyPrivateAiFailClosed.mjs", ...args] });
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
};
const skip = (name, why) => console.log(`SKIP  ${name}  -- ${why}`);

async function callableProbe(projectId, region, idToken) {
  const url = `https://${region}-${projectId}.cloudfunctions.net/interpretWorkOrderReadinessContext`;
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ data: { workOrderId: "CERT-AI-FAIL-CLOSED-PROBE" } }),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text().catch(() => "");
    return { status: response.status, text };
  } catch (error) {
    return { status: 0, text: "", error: error?.name ?? "RequestFailed" };
  }
}

async function main() {
  const target = authorizeVerification(argv);
  console.log(describeTarget(target));
  console.log(`PRIVATE-AI FAIL-CLOSED — LIVE CERTIFICATION (${target.projectId}, role=${target.role})\n`);

  // ── 1. THE REPOSITORY EXPECTATION. Computed fresh from source, never hardcoded here: the CI test
  //       pins the numbers; this command's job is agreement between repo and live.
  const { world, records } = expectedRecords();
  const fp = worldFingerprint(records);
  const expectedByCollection = {};
  for (const r of records) expectedByCollection[r.collection] = (expectedByCollection[r.collection] || 0) + 1;
  console.log(`repository expectation: version ${world.version}, ${records.length} records, fingerprint ${fp.hash}\n`);

  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: target.projectId });
  const db = getFirestore();

  // ── 2. THE SEEDED WORLD EXISTS AND IS THE EXPECTED ONE.
  console.log("-- seeded world (data must be PRESENT before a refusal means anything)");
  const state = await db.collection(STATE_COLLECTION).doc(STATE_DOC_ID).get();
  check("deployment record exists", state.exists);
  if (state.exists) {
    const s = state.data();
    check("deployment record: dataset version matches repo", s.datasetVersion === world.version,
      `${s.datasetVersion} vs ${world.version}`);
    check("deployment record: record count matches repo", s.expectedRecords === records.length,
      `${s.expectedRecords} vs ${records.length}`);
    check("deployment record: fingerprint matches repo", s.fingerprint === fp.hash,
      `${s.fingerprint} vs ${fp.hash}`);
  }

  let liveTotal = 0;
  for (const [collection, expected] of Object.entries(expectedByCollection)) {
    const snap = await db.collection(collection)
      .where(`${MARKER_FIELD}.version`, "==", world.version).count().get();
    const got = snap.data().count;
    liveTotal += got;
    check(`${collection}: ${expected} governed record(s) live`, got === expected, `${got}/${expected}`);
  }
  check(`world total: ${records.length} governed records live`, liveTotal === records.length,
    `${liveTotal}/${records.length}`);

  const employees = await db.collection("employees")
    .where(`${MARKER_FIELD}.version`, "==", world.version).get();
  const linked = employees.docs.filter((d) => typeof d.data().userId === "string" && d.data().userId.length > 0).length;
  check(`employee->principal linkage: ${EXPECTED_LINKED_EMPLOYEES}/${EXPECTED_LINKED_EMPLOYEES} linked`,
    linked === EXPECTED_LINKED_EMPLOYEES, `${linked}/${EXPECTED_LINKED_EMPLOYEES}`);

  // ── 3. THE REGISTRY POSTURE STILL REFUSES.
  console.log("\n-- governed posture");
  check("privateAiSyntheticOperationalInterpretation resolves FALSE for this project",
    resolveSyntheticOperationalInterpretation(ENVIRONMENT_ACTIVATION_REGISTRY, target.projectId) === false);

  // ── 4. THE DEPLOYED CALLABLE STILL REFUSES.
  //
  // The gate in interpretWorkOrderReadiness runs before the work order is even looked up, so the
  // probe id needs no existing document — a refusal (not "not-found") is itself evidence that the
  // refusal precedes every read.
  console.log("\n-- deployed callable");
  const registry = JSON.parse(readFileSync(path.resolve(REPO, "config/environments.json"), "utf8"));
  const envEntry = registry.environments.find((e) => e?.firebase?.projectId === target.projectId);
  const region = envEntry?.firebase?.functionsRegion || "us-central1";

  const anonymous = await callableProbe(target.projectId, region);
  if (anonymous.status === 404) {
    check("interpretWorkOrderReadinessContext refuses (NOT DEPLOYED to this project)", true,
      "refusal by absence; deploy state, not gate state");
  } else {
    check("unauthenticated invocation is refused", anonymous.status !== 200,
      `HTTP ${anonymous.status || anonymous.error}`);
  }

  const email = process.env.CERT_AI_PROBE_EMAIL;
  const password = process.env.CERT_AI_PROBE_PASSWORD;
  if (!email || !password || anonymous.status === 404) {
    skip("authenticated invocation returns the exact EOS refusal",
      anonymous.status === 404
        ? "callable is not deployed to this project"
        : "set CERT_AI_PROBE_EMAIL / CERT_AI_PROBE_PASSWORD (certification principal; values are never printed)");
  } else {
    const apiKey = envEntry?.firebase?.apiKey;
    check("registry carries a web apiKey for the sign-in probe", Boolean(apiKey));
    if (apiKey) {
      const signIn = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!signIn.ok) {
        check("certification principal sign-in", false, `HTTP ${signIn.status} (credential values not printed)`);
      } else {
        const { idToken } = await signIn.json();
        const authed = await callableProbe(target.projectId, region, idToken);
        let result = null;
        try { result = JSON.parse(authed.text)?.result ?? null; } catch { /* judged below */ }
        const exact = result !== null && JSON.stringify(result) === JSON.stringify(EXACT_REFUSAL);
        check("authenticated invocation returns the exact EOS refusal", authed.status === 200 && exact,
          `HTTP ${authed.status}; result ${exact ? "matches" : "does NOT match"} {speak:false, origin:EOS, reason:INTERPRETATION_NOT_PERMITTED_HERE}`);
      }
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nRESULT: ${failed === 0 ? "PASS" : "FAIL"} (${results.length - failed}/${results.length} checks passed)`);
  console.log("writes performed: NONE   credentials printed: NONE");
  return failed === 0 ? 0 : 1;
}

// RUN ONLY WHEN INVOKED DIRECTLY, so the authorization decision can be imported by its test
// without the tool executing on import -- an unguarded main() demands --projectId, refuses, and
// kills the test process. A decision that cannot be imported without running the script is a
// decision that does not get tested.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error("verifyPrivateAiFailClosed failed: " + (err?.message || err));
    process.exit(2);
  });
}
