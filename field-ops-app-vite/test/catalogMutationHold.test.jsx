// DQ-034 -- the Catalog mutation hold, as the browser sees it. NOTHING here mocks config/catalogMutationHold.js: these
// tests run against the COMMITTED constant, so they fail the day somebody lifts the hold on the client without the
// server (or the reverse), or lets a catalog editing surface offer a change while it is on.
//
// Also pinned here (ruled, DQ-034 scanner item): the client scanner still reaches Firebase callables, which is a known
// retirement dependency that stays INACTIVE -- so PART_IDENTIFIER_TRANSPORT_READY must stay false everywhere.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({ call: null }));
vi.mock("firebase/firestore", () => ({ collection: () => { throw new Error("Firestore"); }, getCountFromServer: () => { throw new Error("Firestore"); }, query: () => {}, where: () => {}, limit: () => {} }));
vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("../src/metadata/firestoreListSource.js", () => ({}));
vi.mock("../src/services/catalogApiClient.js", async (orig) => ({
  ...(await orig()),
  catalogApiClient: {
    call: (h.call = vi.fn((operation) => Promise.resolve(operation === "countParts"
      ? { ok: true, result: 1 }
      : { ok: true, result: { parts: [{ id: "p1", version: 1, internalPartNumber: "PRT-1001", name: "Beater", category: "Drive", status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" }], nextCursor: null, limit: 50 } }))),
  },
}));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig()), useSearchParams: () => [new URLSearchParams(), vi.fn()], Link: ({ children }) => children }));

import {
  CATALOG_MUTATION_HOLD, CATALOG_MUTATION_HELD_CODE, CATALOG_MUTATION_HELD_OUTCOME, isCatalogMutationHeldRefusal,
} from "../src/config/catalogMutationHold.js";
import { CATALOG_MUTATION_OPERATIONS } from "../src/services/catalogApiClient.js";
import { usePartMasterWrite } from "../src/hooks/usePartMasterWrite";
import PartMasterList from "../src/modules/inventory/PartMasterList.jsx";

const APP = path.resolve(__dirname, "..");
const REPO = path.resolve(APP, "..");
const read = (p) => readFileSync(path.join(REPO, p), "utf8");

afterEach(cleanup);

describe("the client hold mirrors the server's committed hold", () => {
  // LIFTED 2026-10-01 on BOTH sides by one reviewed change (catalog-cutover-plan.md §5.4 STATUS).
  it("is LIFTED, still names DQ-034, and carries the server's exact reason", () => {
    expect(CATALOG_MUTATION_HOLD.held).toBe(false);
    expect(CATALOG_MUTATION_HOLD.ruling).toBe("DQ-034");
    expect(Object.isFrozen(CATALOG_MUTATION_HOLD)).toBe(true);
    const server = read("functions/src/catalogMaster/catalogWriterState.ts");
    expect(server).toMatch(/CATALOG_MUTATION_HOLD: CatalogMutationHold = Object\.freeze\(\{\s*held: false,/);
    expect(server).toContain(`export const CATALOG_MUTATION_HOLD_REASON = "${CATALOG_MUTATION_HOLD.reason}"`);
  });

  it("recognises the server's refusal code however it arrives", () => {
    expect(read("functions/src/catalogMaster/catalogHttp.ts")).toContain(`code: "${CATALOG_MUTATION_HELD_CODE}"`);
    expect(isCatalogMutationHeldRefusal(CATALOG_MUTATION_HELD_CODE)).toBe(true);
    expect(isCatalogMutationHeldRefusal({ code: "PRECONDITION_FAILED", reason: CATALOG_MUTATION_HELD_CODE })).toBe(true);
    expect(isCatalogMutationHeldRefusal({ code: "PRECONDITION_FAILED", reason: "POSTGRES_CATALOG_INACTIVE" })).toBe(false);
    expect(isCatalogMutationHeldRefusal(null)).toBe(false);
  });

  it("is not environment readiness: no environment and no build define can lift it", () => {
    const envs = read("config/environments.json");
    expect(envs).not.toMatch(/CATALOG_MUTATION/);
    const src = readFileSync(path.join(APP, "src/config/catalogMutationHold.js"), "utf8");
    expect(src).not.toMatch(/__APP_READINESS__|import\.meta\.env|process\.env/);
  });
});

describe("after the lift, the hold no longer stands between a Part change and the Catalog API", () => {
  it("usePartMasterWrite: the hold is off -- a write reaches the client (the server's own capability gates still decide)", async () => {
    const client = { createPart: vi.fn(() => Promise.resolve({ ok: true, result: { id: "P" } })), updatePart: vi.fn(), changePartStatus: vi.fn() };
    const { result } = renderHook(() => usePartMasterWrite({ readinessOverride: true, client }));
    expect(result.current.mutationHeld).toBe(false);
    let outcome;
    await act(async () => { outcome = await result.current.runCreate({ partId: "P" }); });
    expect(outcome).not.toBe(CATALOG_MUTATION_HELD_OUTCOME);
    expect(client.createPart).toHaveBeenCalledTimes(1);
  });

  it("Part Master: reads from the Catalog API and no longer states the migration pause", async () => {
    render(<MemoryRouter><PartMasterList /></MemoryRouter>);
    await screen.findAllByText(/PRT-1001|Beater/);
    expect(screen.queryByText(/catalog changes are paused during the migration\. you can still/i)).toBeNull();
    expect(h.call.mock.calls.map(([op]) => op)).toContain("searchParts");
  });
});


describe("PART_IDENTIFIER_TRANSPORT_READY: ON in the nonprod sandbox only, and the identifier transport reaches no Firebase", () => {
  // RE-DECIDED by the Controller (TRUCK INVENTORY ACTIVATION OD-T6, 2026-10-01: "Correct the EOS response contract and activate
  // the transport. No new scanner."). The flag gates ONLY the Part identifier transport (services/partAliasCallableClient.js),
  // which now calls the governed EOS Catalog transport -- so what must hold is that THAT module reaches no Firebase, that the
  // flip is the nonprod sandbox's alone, and that tests stay fail-closed. Other scanner modules that still reach Firebase are
  // governed by their own readiness flags and by the Firebase exit ratchet, not by this one.
  it("the identifier transport imports no Firebase; only platform-sandbox flips it; tests stay false", () => {
    const transport = readFileSync(path.join(APP, "src/services/partAliasCallableClient.js"), "utf8");
    expect(transport).not.toMatch(/from\s+["']firebase\//);
    expect(transport).not.toMatch(/httpsCallable\s*\(/);
    expect(transport).toMatch(/catalogApiClient/);
    const registry = JSON.parse(read("config/environments.json"));
    const flipped = registry.environments
      .filter((env) => (env.readiness ?? {}).PART_IDENTIFIER_TRANSPORT_READY !== false)
      .map((env) => env.id);
    expect(flipped).toEqual(["platform-sandbox"]);
    expect(readFileSync(path.join(APP, "vitest.config.js"), "utf8")).toMatch(/PART_IDENTIFIER_TRANSPORT_READY:\s*false/);
  });
});
