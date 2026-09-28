// PASS 11 RETAIL SALES -- useCommercialCapabilities: the Commercial screens' offer comes from the PostgreSQL capability read
// (readMyCommercialCapabilities), the authority that authorizes the commands -- never from the Firebase feed. Fail closed.
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { COMMERCIAL_CAPABILITY_STATE, useCommercialCapabilities } from "../src/hooks/useCommercialCapabilities.js";
import {
  COMMERCIAL_OFFER_CAPABILITY_IDS, MY_COMMERCIAL_CAPABILITIES_OPERATION, commercialCapabilitiesFrom,
} from "../src/access/commercialCapabilityAccess.js";
import { COMMERCIAL_READ_OPERATIONS } from "../src/services/commercialApiClient.js";

afterEach(cleanup);

const clientAnswering = (answer) => ({ call: vi.fn(async () => (typeof answer === "function" ? answer() : answer)) });
const SALESPERSON = ["opportunity.read", "opportunity.write", "opportunity.createSalesOrder", "salesAgreement.read", "salesAgreement.create",
  "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.read", "salesOrder.write"];

describe("the closed list and the operation", () => {
  it("mirrors the server's COMMERCIAL_OFFER_CAPABILITY_IDS exactly; the operation is a served read", () => {
    const server = readFileSync(path.resolve(process.cwd(), "../functions/src/eosCommercial/myCommercialCapabilities.ts"), "utf8");
    const block = server.slice(server.indexOf("export const COMMERCIAL_OFFER_CAPABILITY_IDS"), server.indexOf("] as const);"));
    expect([...block.matchAll(/"([a-zA-Z.]+)"/g)].map((m) => m[1])).toEqual([...COMMERCIAL_OFFER_CAPABILITY_IDS]);
    expect(COMMERCIAL_READ_OPERATIONS).toContain(MY_COMMERCIAL_CAPABILITIES_OPERATION);
  });

  it("commercialCapabilitiesFrom accepts only the governed shape; a scoped READ is offerable, never a scoped write", () => {
    expect([...commercialCapabilitiesFrom({ capabilities: ["opportunity.write"], channelScopedReads: [] })]).toEqual(["opportunity.write"]);
    expect([...commercialCapabilitiesFrom({ capabilities: [], channelScopedReads: ["salesOrder.read"] })]).toEqual(["salesOrder.read"]);
    for (const bad of [null, [], "x", {}, { capabilities: [] }, { capabilities: ["opportunity.read"], channelScopedReads: ["opportunity.write"] },
      { capabilities: ["salesOrder.fulfill"], channelScopedReads: [] }, { capabilities: [1], channelScopedReads: [] }]) {
      expect(commercialCapabilitiesFrom(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("useCommercialCapabilities", () => {
  it("offers exactly what a READY answer holds, asked once, with no input", async () => {
    const client = clientAnswering({ ok: true, result: { capabilities: SALESPERSON, channelScopedReads: [] } });
    const { result } = renderHook(() => useCommercialCapabilities({ uid: "u1" }, { client }));
    expect(result.current.hasCapability("opportunity.write")).toBe(false); // loading: nothing offered
    await waitFor(() => expect(result.current.status).toBe(COMMERCIAL_CAPABILITY_STATE.READY));
    expect(client.call).toHaveBeenCalledWith(MY_COMMERCIAL_CAPABILITIES_OPERATION, undefined);
    for (const id of SALESPERSON) expect(result.current.hasCapability(id)).toBe(true);
    expect(result.current.hasCapability("salesOrder.fulfill")).toBe(false);
  });

  it("the Owner's pinned parity gap is visible to the UI: draft offered, accept / Mark Won not", async () => {
    const owner = ["opportunity.read", "opportunity.write", "salesAgreement.read", "salesAgreement.create", "salesAgreement.updateDraft", "salesOrder.read", "salesOrder.write"];
    const ownerClient = clientAnswering({ ok: true, result: { capabilities: owner, channelScopedReads: [] } });
    const { result } = renderHook(() => useCommercialCapabilities({ uid: "owner" }, { client: ownerClient }));
    await waitFor(() => expect(result.current.status).toBe(COMMERCIAL_CAPABILITY_STATE.READY));
    expect(result.current.hasCapability("salesAgreement.create")).toBe(true);
    expect(result.current.hasCapability("salesAgreement.accept")).toBe(false);
    expect(result.current.hasCapability("opportunity.createSalesOrder")).toBe(false);
  });

  it("fails closed on refusal, outage, a throw, a malformed answer and when signed out", async () => {
    const cases = [
      { ok: false, code: "FORBIDDEN", reason: "ACTOR_NOT_TENANT_MEMBER" },
      { ok: false, code: "UNREACHABLE" },
      () => { throw new Error("boom"); },
      { ok: true, result: { capabilities: ["opportunity.write", "made.up"], channelScopedReads: [] } },
    ];
    for (const answer of cases) {
      const failing = clientAnswering(answer);
      const { result, unmount } = renderHook(() => useCommercialCapabilities({ uid: "u" }, { client: failing }));
      await waitFor(() => expect(result.current.status).toBe(COMMERCIAL_CAPABILITY_STATE.FAILED));
      expect(result.current.hasCapability("opportunity.write")).toBe(false);
      unmount();
    }
    const client = clientAnswering({ ok: true, result: { capabilities: SALESPERSON, channelScopedReads: [] } });
    const { result } = renderHook(() => useCommercialCapabilities(null, { client }));
    await waitFor(() => expect(result.current.status).toBe(COMMERCIAL_CAPABILITY_STATE.FAILED));
    expect(client.call).not.toHaveBeenCalled();
    expect(result.current.hasCapability("opportunity.read")).toBe(false);
  });

  it("re-reads on a principal change and never shows the previous principal's offer", async () => {
    let held = SALESPERSON;
    const client = clientAnswering(() => ({ ok: true, result: { capabilities: held, channelScopedReads: [] } }));
    const { result, rerender } = renderHook(({ user }) => useCommercialCapabilities(user, { client }), { initialProps: { user: { uid: "a" } } });
    await waitFor(() => expect(result.current.hasCapability("opportunity.write")).toBe(true));
    held = [];
    rerender({ user: { uid: "b" } });
    expect(result.current.hasCapability("opportunity.write")).toBe(false);
    await waitFor(() => expect(result.current.status).toBe(COMMERCIAL_CAPABILITY_STATE.READY));
    expect(result.current.hasCapability("opportunity.write")).toBe(false);
    await act(async () => { result.current.reload(); });
    expect(client.call).toHaveBeenCalledTimes(3);
  });

  it("imports no Firebase module", () => {
    for (const file of ["src/hooks/useCommercialCapabilities.js", "src/access/commercialCapabilityAccess.js"]) {
      expect(readFileSync(path.resolve(process.cwd(), file), "utf8")).not.toMatch(/from\s+["']firebase|firebase\/firebase/);
    }
  });
});
