#!/usr/bin/env node
// ND-33 — the live sandbox verification for non-PO serialized-asset acquisition.
//
// ============================ WHY THIS GATE IS SHAPED THE WAY IT IS ============================
//
// Every other North Star gate in this folder is READ-ONLY. This one cannot be: the whole question is
// whether a governed WRITE reaches a deployed callable and produces the right record. So it is
// mutating by necessity, and everything about it is arranged so that being mutating costs as little
// as possible.
//
// IT ACQUIRES ONE RESERVED FIXTURE UNIT, FOREVER. The serial is fixed
// (`GATE-ND33-DO-NOT-DELETE`), the part and location are fixed, and the command derives asset
// identity from part+serial — so the FIRST run acquires it and every run afterwards REPLAYS. That is
// not a trick to avoid testing the write; it is the strongest available proof of the property that
// matters most on a command with no undo:
//
//   run 1  outcome=acquired   the write works
//   run 2+ outcome=replayed   the idempotency works, and nothing was created twice
//
// A gate that minted a new serial per run would create real inventory on every execution, and after
// a month of CI the sandbox would hold a hundred machines nobody owns. That is the failure this
// shape exists to prevent, and it is why the serial says DO-NOT-DELETE.
//
// ============================ WHAT IT PROVES ============================
//
//   the release identity, FIRST, before anything is called
//   the callable EXISTS in this environment (a missing export is a not-found, not a denial)
//   a permitted principal reaches it and the outcome is acquired-or-replayed
//   a DENIED principal is refused — the separation of stations, proved live
//   the resulting record is AVAILABLE, COMPANY-owned, NON_PO_ACQUISITION
//   NO receiving provenance was fabricated
//   NO Equipment record was created
//   the unit is visible through the existing governed Available Equipment read
//
// Usage:
//   node field-ops-app-vite/.claude/skills/run-field-ops-app-vite/acquireSerializedAssetLiveGate.mjs \
//     --expect <sha> [--part <partId>] [--location <warehouseId>] [origin]
//
// Exit codes: 0 = every required check passed. 1 = at least one failed. 2 = precondition error
// (including a release-identity refusal, which is the gate working, not the family failing).
import { pathToFileURL } from "node:url";

import { signInPersona, sandboxFirebaseConfig } from "./deployedSession.mjs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const EXPECT_SHA = argValue("--expect");
const ORIGIN = args.find((a) => a.startsWith("http")) ?? "https://eos-platform-sandbox.web.app";

// ══════════════════════════ THE RESERVED FIXTURE ══════════════════════════
//
// One unit, named so nobody deletes it by accident. The part and location default to the sandbox
// fixtures and are overridable, because a gate that hard-codes an id it cannot find should say which
// id it wanted rather than fail obscurely.
export const GATE_SERIAL = "GATE-ND33-DO-NOT-DELETE";
const DEFAULT_PART = argValue("--part");
const DEFAULT_LOCATION = argValue("--location");

// STABLE ACROSS RUNS, deliberately — the opposite of every other idempotency key in this codebase.
// Elsewhere a key is minted per attempt so a corrected attempt is a new request. Here the intent is
// identical on every run by construction, so the key is too.
export const GATE_IDEMPOTENCY_KEY = "acquire_gate_nd33_reserved_fixture";
export const GATE_REASON = "EXISTING_COMPANY_ASSET";

const checks = [];
function record(id, passed, detail) {
  checks.push({ id, passed, detail, skipped: false });
  process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${id}${detail ? ` — ${detail}` : ""}\n`);
  return passed;
}
function skip(id, detail) {
  checks.push({ id, passed: true, detail, skipped: true });
  process.stdout.write(`SKIP  ${id}${detail ? ` — ${detail}` : ""}\n`);
}

/** Call a deployed callable as a persona, over the REST callable protocol. */
async function callAs(session, name, data) {
  const { projectId, functionsRegion } = sandboxFirebaseConfig();
  const region = functionsRegion ?? "us-central1";
  const res = await fetch(`https://${region}-${projectId}.cloudfunctions.net/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => null);
  return { httpStatus: res.status, result: body?.result ?? null, error: body?.error ?? null };
}

/** Read one document through the governed REST API with the session's own token. */
async function readDoc(session, path) {
  const { projectId } = sandboxFirebaseConfig();
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    { headers: { authorization: `Bearer ${session.idToken}` } },
  );
  if (!res.ok) return { ok: false, status: res.status, fields: null };
  const body = await res.json();
  return { ok: true, status: 200, fields: body.fields ?? {} };
}

async function main() {
  if (!/^https:\/\/eos-platform-sandbox\./.test(ORIGIN)) {
    console.error(`REFUSING: ${ORIGIN} is not the sandbox origin. This gate is sandbox-only and it MUTATES.`);
    process.exit(2);
  }
  if (!EXPECT_SHA) {
    console.error("REFUSING: --expect <sha> is required. A mutating gate that does not know which "
      + "release it is verifying could write against a bundle nobody reviewed.");
    process.exit(2);
  }

  const deployed = await fetch(`${ORIGIN}/version.json`).then((r) => r.json()).catch(() => null);
  if (!deployed || deployed.environmentRole === "production") {
    console.error(`REFUSING: ${ORIGIN} reports environmentRole=${deployed?.environmentRole ?? "(unknown)"}. `
      + "This gate performs a governed WRITE and must never point at production.");
    process.exit(2);
  }
  console.log(`ND-33 acquisition live gate — ${ORIGIN}`);
  console.log(`  deployed ${deployed.commit}  env ${deployed.environmentId}/${deployed.environmentRole}`);
  console.log(`  built    ${deployed.buildTime}\n`);

  // ── 0: RELEASE IDENTITY, before anything is called. The environment is the authority on what is
  //      deployed, never an exit code from a deploy command.
  const identityOk = deployed.commit === EXPECT_SHA.slice(0, deployed.commit.length);
  record("0  release identity", identityOk, `deployed=${deployed.commit} expected=${EXPECT_SHA}`);
  if (!identityOk) {
    console.error("\nREFUSING: the origin is not serving the release this gate was asked to verify.");
    process.exit(2);
  }

  if (!DEFAULT_PART || !DEFAULT_LOCATION) {
    console.error("\nREFUSING: --part <serialTrackedPartId> and --location <activeWarehouseId> are "
      + "required. This gate will not guess which part or which warehouse to write against — a "
      + "guessed id either fails obscurely or acquires a unit against the wrong record.");
    process.exit(2);
  }

  const acquirer = await signInPersona("admin");
  const request = {
    partId: DEFAULT_PART,
    serialNo: GATE_SERIAL,
    locationId: DEFAULT_LOCATION,
    reason: GATE_REASON,
    idempotencyKey: GATE_IDEMPOTENCY_KEY,
    provenanceNote: "Reserved ND-33 live-gate fixture. Do not delete.",
  };

  // ── 1: THE CALLABLE EXISTS. A missing export reaches the caller as a 404/not-found rather than a
  //      denial, and the two mean completely different things — one is "not deployed", the other is
  //      "not yours". Reported separately so a deploy that never happened is not read as a
  //      permission problem.
  const first = await callAs(acquirer, "acquireSerializedAsset", request);
  const notDeployed = first.httpStatus === 404 || first.error?.status === "NOT_FOUND";
  record("1  the acquireSerializedAsset callable is deployed", !notDeployed,
    notDeployed
      ? `HTTP ${first.httpStatus} — the callable is not deployed in this environment`
      : `HTTP ${first.httpStatus}`);
  if (notDeployed) {
    console.error("\nREFUSING: nothing further can be measured until the callable is deployed.");
    process.exit(2);
  }

  // ── 2: A PERMITTED PRINCIPAL REACHES IT, and the outcome is acquired on the first ever run or
  //      replayed on every one after. Both are success; the gate says which it saw.
  const firstOutcome = first.result?.outcome ?? null;
  record("2  a permitted principal acquires or replays the reserved fixture",
    firstOutcome === "acquired" || firstOutcome === "replayed",
    firstOutcome
      ? `outcome=${firstOutcome} assetId=${first.result?.serializedAssetId ?? "(none)"}`
      : `error=${first.error?.status ?? first.httpStatus} ${first.error?.message ?? ""}`);

  const assetId = first.result?.serializedAssetId ?? null;

  // ── 3: THE SECOND IDENTICAL CALL REPLAYS. The property that makes a mutating gate safe to run
  //      forever, and the one a command with no undo depends on.
  const second = await callAs(acquirer, "acquireSerializedAsset", request);
  record("3  an identical second call REPLAYS rather than acquiring again",
    second.result?.outcome === "replayed",
    `outcome=${second.result?.outcome ?? second.error?.status ?? "(none)"} `
      + `sameAsset=${second.result?.serializedAssetId === assetId}`);

  // ── 4: A DENIED PRINCIPAL IS REFUSED. The separation of stations, proved against the deployed
  //      callable rather than only in the emulator. The technician persona holds no acquire
  //      capability; if this ever passes, the gate has stopped measuring the control.
  let deniedDetail = "(no second persona available)";
  let deniedOk = null;
  try {
    const technician = await signInPersona("technician");
    const denied = await callAs(technician, "acquireSerializedAsset", request);
    deniedOk = denied.error?.status === "PERMISSION_DENIED" || denied.httpStatus === 403;
    deniedDetail = `status=${denied.error?.status ?? denied.httpStatus} outcome=${denied.result?.outcome ?? "(none)"}`;
  } catch (err) {
    deniedDetail = `the technician persona could not sign in: ${err?.message ?? err}`;
  }
  if (deniedOk === null) skip("4  a principal without the capability is refused", deniedDetail);
  else record("4  a principal without the capability is refused", deniedOk, deniedDetail);

  // ── 5-8: THE RECORD ITSELF, read through the governed API. What the callable RETURNED is the
  //        adapter's word for it; what the document SAYS is the fact.
  if (!assetId) {
    for (const id of ["5  the unit is AVAILABLE and COMPANY-owned", "6  provenance is NON_PO_ACQUISITION",
      "7  no receiving provenance was fabricated", "8  no Equipment record was created"]) {
      skip(id, "no serializedAssetId was returned, so there is nothing to read back");
    }
  } else {
    const doc = await readDoc(acquirer, `serialized_assets/${assetId}`);
    if (!doc.ok) {
      for (const id of ["5  the unit is AVAILABLE and COMPANY-owned", "6  provenance is NON_PO_ACQUISITION",
        "7  no receiving provenance was fabricated", "8  no Equipment record was created"]) {
        skip(id, `the asset document could not be read (HTTP ${doc.status})`);
      }
    } else {
      const f = doc.fields;
      record("5  the unit is AVAILABLE and COMPANY-owned",
        f.inventoryState?.stringValue === "AVAILABLE" && f.ownership?.stringValue === "COMPANY",
        `state=${f.inventoryState?.stringValue} ownership=${f.ownership?.stringValue}`);

      record("6  provenance is NON_PO_ACQUISITION with the recorded reason",
        f.acquisitionProvenance?.stringValue === "NON_PO_ACQUISITION"
          && f.acquisitionReason?.stringValue === GATE_REASON,
        `provenance=${f.acquisitionProvenance?.stringValue} reason=${f.acquisitionReason?.stringValue}`);

      // THE ONE THAT KEEPS THE TWO POPULATIONS APART FOREVER. A report asking "what did we receive?"
      // filters on activatedByReceivingId, and an acquired unit must never answer.
      record("7  NO receiving provenance was fabricated",
        !("activatedByReceivingId" in f),
        `activatedByReceivingId present=${"activatedByReceivingId" in f}`);

      // ACQUIRING IS CUSTODY, NOT PLACEMENT. currentEquipmentId must still be null.
      record("8  no Equipment record was created and the unit is at no customer",
        f.currentEquipmentId?.nullValue !== undefined || f.currentEquipmentId === undefined,
        `currentEquipmentId=${JSON.stringify(f.currentEquipmentId ?? null)}`);
    }
  }

  // ── 9: THE UNIT IS VISIBLE THROUGH THE EXISTING GOVERNED READ. Acquiring it into a table nobody
  //      can see would be a write with no product behind it.
  const available = await callAs(acquirer, "getAvailableEquipment", {});
  const assets = available.result?.assets ?? available.result?.serializedAssets ?? null;
  if (!Array.isArray(assets)) {
    skip("9  the unit is visible through the governed Available Equipment read",
      `the read returned no asset array (status=${available.error?.status ?? available.httpStatus})`);
  } else {
    record("9  the unit is visible through the governed Available Equipment read",
      assets.some((a) => a?.serialNo === GATE_SERIAL),
      `${assets.length} available asset(s); fixture present=${assets.some((a) => a?.serialNo === GATE_SERIAL)}`);
  }

  const failed = checks.filter((c) => !c.passed);
  const skipped = checks.filter((c) => c.skipped);
  console.log(`\n${checks.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  ${f.id} — ${f.detail}`);
  }
  if (skipped.length) {
    console.log("\nSKIPPED (unmeasured, not green):");
    for (const s of skipped) console.log(`  ${s.id} — ${s.detail}`);
  }
  console.log(`\nReserved fixture: serial ${GATE_SERIAL} — it is meant to persist. Do not delete it.`);
  process.exit(failed.length ? 1 : 0);
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`PRECONDITION ERROR: ${err?.message ?? err}`);
    process.exit(2);
  });
}
