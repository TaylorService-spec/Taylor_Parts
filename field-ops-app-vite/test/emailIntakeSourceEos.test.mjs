// ADMINISTRATION -> EMAIL & COMMUNICATIONS, on EOS (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30).
//
// The screen's source maps every method onto ONE EOS operation on POST /operations/inbound-work; nothing reaches a
// Firebase callable, and the screen's authority comes from EOS (readInboundWorkAccess), not the Firebase feed.
//
// Run: node --test test/emailIntakeSourceEos.test.mjs   (also `npm test`)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createEosEmailIntakeSource, ADMIN_EMAIL_INTAKE_MANAGE, ADMIN_EMAIL_INTAKE_READ, SOURCE_STATUS } from "../src/access/inboundWorkSource.js";

function recorder(result = { ok: true, result: { detail: "ok" } }) {
  const calls = [];
  const call = async (operation, input) => { calls.push([operation, input]); return typeof result === "function" ? result(operation) : result; };
  return { calls, call };
}

describe("the EOS email intake source", () => {
  it("maps each screen method to one EOS operation", async () => {
    const r = recorder();
    const s = createEosEmailIntakeSource({ call: r.call });
    await s.readAccess();
    await s.getConfiguration();
    await s.getProviderReadiness();
    await s.startAuthorization({ connectionId: "c1", redirectUri: "https://x/y" });
    await s.completeAuthorization({ connectionId: "c1", code: "k", state: "s", redirectUri: "https://x/y" });
    await s.testConnection({ connectionId: "c1" });
    await s.disconnect({ connectionId: "c1" });
    await s.pollNow({ mailboxId: "m1" });
    await s.retryDelivery({ failureId: "f1" });
    await s.saveConnection({ config: { connectionName: "Taylor M365", provider: "MICROSOFT_365", tenantOrWorkspace: "t", connectedAccount: "a@x" } });
    await s.saveMailbox({ config: { connectionId: "c1", displayName: "Service", emailAddress: "s@x", purpose: "SERVICE", defaultQueue: "", operatingCompanyId: "taylor" } });
    assert.deepEqual(r.calls.map((c) => c[0]), [
      "readInboundWorkAccess", "readInboundIntakeConfiguration", "readInboundProviderReadiness", "startInboundConnectionAuthorization",
      "completeInboundConnectionAuthorization", "testInboundConnection", "disconnectInboundConnection", "pollInboundMailboxNow",
      "retryInboundDelivery", "saveInboundConnection", "saveInboundMailbox",
    ]);
    assert.deepEqual(r.calls[9][1], { connectionName: "Taylor M365", provider: "MICROSOFT_365", tenantOrWorkspace: "t", connectedAccount: "a@x" });
    assert.deepEqual(r.calls[10][1], { displayName: "Service", emailAddress: "s@x", purpose: "SERVICE", connectionId: "c1", suggestedOperatingCompanyId: "taylor" });
  });

  it("maps outcomes honestly: denied, unavailable, and a write that did not happen", async () => {
    const denied = createEosEmailIntakeSource({ call: recorder({ ok: false, code: "FORBIDDEN", reason: "CAPABILITY_MISSING" }).call });
    assert.equal((await denied.getConfiguration()).status, SOURCE_STATUS.DENIED);
    const off = createEosEmailIntakeSource({ call: recorder({ ok: false, code: "NOT_ACTIVATED" }).call });
    assert.equal((await off.getConfiguration()).status, SOURCE_STATUS.UNAVAILABLE);
    const w = await denied.saveConnection({ config: { connectionName: "x", provider: "MICROSOFT_365" } });
    assert.deepEqual([w.ok, w.code], [false, "CAPABILITY_MISSING"]);
  });

  it("the governed capability is the PostgreSQL intake capability, and no Firebase is reachable", () => {
    assert.equal(ADMIN_EMAIL_INTAKE_READ, "inboundWork.intake.manage");
    assert.equal(ADMIN_EMAIL_INTAKE_MANAGE, "inboundWork.intake.manage");
    for (const f of ["src/access/inboundWorkSource.js", "src/modules/administration/AdminEmailCommunications.jsx"]) {
      const code = readFileSync(path.resolve(process.cwd(), f), "utf8").replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(code, /from ["']firebase|import\(["']firebase|firebase\/functions|httpsCallable|useGovernedCapabilities/, f);
    }
  });
});
