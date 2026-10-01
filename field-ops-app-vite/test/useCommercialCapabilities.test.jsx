// PASS 11 RETAIL SALES -- useCommercialCapabilities: the Commercial screens' offer comes from the PostgreSQL capability read
// (readMyCommercialCapabilities), the authority that authorizes the commands -- never from the Firebase feed. Fail closed.
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { COMMERCIAL_CAPABILITY_STATE, useCommercialCapabilities } from "../src/hooks/useCommercialCapabilities.js";
import {
  CHANNEL_CHOOSING_CAPABILITY_IDS, COMMERCIAL_OFFER_CAPABILITY_IDS, MY_COMMERCIAL_CAPABILITIES_OPERATION, commercialCapabilitiesFrom,
  commercialChannelOffersFrom,
} from "../src/access/commercialCapabilityAccess.js";
import { COMMERCIAL_READ_OPERATIONS } from "../src/services/commercialApiClient.js";

afterEach(cleanup);

const clientAnswering = (answer) => ({ call: vi.fn(async () => (typeof answer === "function" ? answer() : answer)) });
const SALESPERSON = ["opportunity.read", "opportunity.write", "opportunity.createSalesOrder", "salesAgreement.read", "salesAgreement.create",
  "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.read", "salesOrder.write"];
const OFFERS = (opportunity = ["RETAIL"], order = opportunity) => ({ "opportunity.write": opportunity, "salesOrder.write": order });

describe("the closed list and the operation", () => {
  it("mirrors the server's COMMERCIAL_OFFER_CAPABILITY_IDS exactly; the operation is a served read", () => {
    const server = readFileSync(path.resolve(process.cwd(), "../functions/src/eosCommercial/myCommercialCapabilities.ts"), "utf8");
    const block = server.slice(server.indexOf("export const COMMERCIAL_OFFER_CAPABILITY_IDS"), server.indexOf("] as const);"));
    expect([...block.matchAll(/"([a-zA-Z.]+)"/g)].map((m) => m[1])).toEqual([...COMMERCIAL_OFFER_CAPABILITY_IDS]);
    expect(COMMERCIAL_READ_OPERATIONS).toContain(MY_COMMERCIAL_CAPABILITIES_OPERATION);
  });

  it("commercialCapabilitiesFrom accepts only the governed shape; a channel-scoped holding is offerable (DQ-020)", () => {
    expect([...commercialCapabilitiesFrom({ capabilities: ["opportunity.write"], channelScoped: [] })]).toEqual(["opportunity.write"]);
    expect([...commercialCapabilitiesFrom({ capabilities: [], channelScoped: ["salesOrder.read"] })]).toEqual(["salesOrder.read"]);
    expect([...commercialCapabilitiesFrom({ capabilities: [], channelScoped: ["opportunity.write"] })]).toEqual(["opportunity.write"]);
    for (const bad of [null, [], "x", {}, { capabilities: [] }, { capabilities: ["opportunity.read"], channelScoped: ["made.up"] },
      { capabilities: ["salesOrder.fulfill"], channelScoped: [] }, { capabilities: [1], channelScoped: [] }]) {
      expect(commercialCapabilitiesFrom(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("useCommercialCapabilities", () => {
  it("offers exactly what a READY answer holds, asked once, with no input", async () => {
    const client = clientAnswering({ ok: true, result: { capabilities: SALESPERSON, channelScoped: [], channelOffers: OFFERS() } });
    const { result } = renderHook(() => useCommercialCapabilities({ uid: "u1" }, { client }));
    expect(result.current.hasCapability("opportunity.write")).toBe(false); // loading: nothing offered
    await waitFor(() => expect(result.current.status).toBe(COMMERCIAL_CAPABILITY_STATE.READY));
    expect(client.call).toHaveBeenCalledWith(MY_COMMERCIAL_CAPABILITIES_OPERATION, undefined);
    for (const id of SALESPERSON) expect(result.current.hasCapability(id)).toBe(true);
    expect(result.current.hasCapability("salesOrder.fulfill")).toBe(false);
  });

  it("the Owner's pinned parity gap is visible to the UI: draft offered, accept / Mark Won not", async () => {
    const owner = ["opportunity.read", "opportunity.write", "salesAgreement.read", "salesAgreement.create", "salesAgreement.updateDraft", "salesOrder.read", "salesOrder.write"];
    const ownerClient = clientAnswering({ ok: true, result: { capabilities: owner, channelScoped: [], channelOffers: OFFERS() } });
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
      { ok: true, result: { capabilities: ["opportunity.write", "made.up"], channelScoped: [], channelOffers: OFFERS() } },
    ];
    for (const answer of cases) {
      const failing = clientAnswering(answer);
      const { result, unmount } = renderHook(() => useCommercialCapabilities({ uid: "u" }, { client: failing }));
      await waitFor(() => expect(result.current.status).toBe(COMMERCIAL_CAPABILITY_STATE.FAILED));
      expect(result.current.hasCapability("opportunity.write")).toBe(false);
      unmount();
    }
    const client = clientAnswering({ ok: true, result: { capabilities: SALESPERSON, channelScoped: [], channelOffers: OFFERS() } });
    const { result } = renderHook(() => useCommercialCapabilities(null, { client }));
    await waitFor(() => expect(result.current.status).toBe(COMMERCIAL_CAPABILITY_STATE.FAILED));
    expect(client.call).not.toHaveBeenCalled();
    expect(result.current.hasCapability("opportunity.read")).toBe(false);
  });

  it("re-reads on a principal change and never shows the previous principal's offer", async () => {
    let held = SALESPERSON;
    const client = clientAnswering(() => ({ ok: true, result: { capabilities: held, channelScoped: [], channelOffers: OFFERS() } }));
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

  it("AUTHORIZED CHANNELS ONLY (DQ-4): channelsFor offers exactly the server's per-capability channels; nothing until READY; a malformed offer fails the whole answer", async () => {
    const client = clientAnswering({ ok: true, result: { capabilities: [], channelScoped: ["opportunity.write", "salesOrder.write"], channelOffers: OFFERS(["NATIONAL_ACCOUNTS"]) } });
    const { result } = renderHook(() => useCommercialCapabilities({ uid: "na" }, { client }));
    expect(result.current.channelsFor("opportunity.write")).toEqual([]); // loading: no channel offered
    await waitFor(() => expect(result.current.status).toBe(COMMERCIAL_CAPABILITY_STATE.READY));
    expect(result.current.channelsFor("opportunity.write")).toEqual(["NATIONAL_ACCOUNTS"]);
    expect(result.current.channelsFor("salesOrder.write")).toEqual(["NATIONAL_ACCOUNTS"]);
    expect(result.current.channelsFor("salesAgreement.accept")).toEqual([], "not a channel-choosing capability");
    for (const channelOffers of [undefined, {}, OFFERS(["MADE_UP"]), OFFERS(["RETAIL", "RETAIL"]), { ...OFFERS(), "salesAgreement.accept": [] }, { "opportunity.write": ["RETAIL"] }]) {
      const bad = clientAnswering({ ok: true, result: { capabilities: SALESPERSON, channelScoped: [], channelOffers } });
      const { result: r, unmount } = renderHook(() => useCommercialCapabilities({ uid: "x" }, { client: bad }));
      await waitFor(() => expect(r.current.status).toBe(COMMERCIAL_CAPABILITY_STATE.FAILED));
      expect(r.current.channelsFor("opportunity.write")).toEqual([]);
      expect(r.current.hasCapability("opportunity.write")).toBe(false);
      unmount();
    }
  });

  it("the channel-choosing list mirrors the server's CHANNEL_CHOOSING_CAPABILITY_IDS exactly", () => {
    const server = readFileSync(path.resolve(process.cwd(), "../functions/src/eosCommercial/myCommercialCapabilities.ts"), "utf8");
    const line = server.slice(server.indexOf("export const CHANNEL_CHOOSING_CAPABILITY_IDS"), server.indexOf("] as const);", server.indexOf("export const CHANNEL_CHOOSING_CAPABILITY_IDS")));
    expect([...line.matchAll(/"([a-zA-Z.]+)"/g)].map((m) => m[1])).toEqual([...CHANNEL_CHOOSING_CAPABILITY_IDS]);
    expect(commercialChannelOffersFrom({ channelOffers: OFFERS([], []) })).toEqual(OFFERS([], []));
  });

  it("imports no Firebase module", () => {
    for (const file of ["src/hooks/useCommercialCapabilities.js", "src/access/commercialCapabilityAccess.js"]) {
      expect(readFileSync(path.resolve(process.cwd(), file), "utf8")).not.toMatch(/from\s+["']firebase|firebase\/firebase/);
    }
  });
});
