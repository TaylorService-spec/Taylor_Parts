// DQ-034 -- the Catalog mutation hold, as the browser sees it. NOTHING here mocks config/catalogMutationHold.js: these
// tests run against the COMMITTED constant, so they fail the day somebody lifts the hold on the client without the
// server (or the reverse), or lets a catalog editing surface offer a change while it is on.
//
// Also pinned here (ruled, DQ-034 scanner item): the client scanner still reaches Firebase callables, which is a known
// retirement dependency that stays INACTIVE -- so PART_IDENTIFIER_TRANSPORT_READY must stay false everywhere.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
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
  it("is ON, names DQ-034, and carries the server's exact reason", () => {
    expect(CATALOG_MUTATION_HOLD.held).toBe(true);
    expect(CATALOG_MUTATION_HOLD.ruling).toBe("DQ-034");
    expect(Object.isFrozen(CATALOG_MUTATION_HOLD)).toBe(true);
    const server = read("functions/src/catalogMaster/catalogWriterState.ts");
    expect(server).toMatch(/CATALOG_MUTATION_HOLD: CatalogMutationHold = Object\.freeze\(\{\s*held: true,/);
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

describe("under the committed hold, no Part change reaches the Catalog API", () => {
  it("usePartMasterWrite: even readinessOverride:true is held; every action is the paused outcome, zero calls", async () => {
    const client = { createPart: vi.fn(), updatePart: vi.fn(), changePartStatus: vi.fn() };
    const { result } = renderHook(() => usePartMasterWrite({ readinessOverride: true, client }));
    expect(result.current.mutationHeld).toBe(true);
    expect(result.current.writeReady).toBe(false);
    let outcomes;
    await act(async () => {
      outcomes = [
        await result.current.runCreate({ partId: "P" }),
        await result.current.runUpdate("P", 1, { name: "x" }, { name: "y" }),
        await result.current.runChangeStatus("P", 1, "INACTIVE"),
      ];
    });
    for (const o of outcomes) expect(o).toBe(CATALOG_MUTATION_HELD_OUTCOME);
    expect(client.createPart).not.toHaveBeenCalled();
    expect(client.updatePart).not.toHaveBeenCalled();
    expect(client.changePartStatus).not.toHaveBeenCalled();
  });

  it("Part Master: reads from the Catalog API, states the pause, and offers no create / edit / status", async () => {
    render(<MemoryRouter><PartMasterList /></MemoryRouter>);
    expect(await screen.findByText(/catalog changes are paused during the migration\. you can still/i)).toBeTruthy();
    const newPart = screen.getByRole("button", { name: /new part/i });
    expect(newPart.disabled).toBe(true);
    fireEvent.click(newPart);
    for (const name of [/^edit$/i, /^status$/i]) {
      const b = screen.getByRole("button", { name });
      expect(b.disabled).toBe(true);
      fireEvent.click(b);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
    const ops = h.call.mock.calls.map(([op]) => op);
    expect(ops).toContain("searchParts");
    expect(ops.filter((op) => CATALOG_MUTATION_OPERATIONS.includes(op))).toEqual([]);
  });
});

// ═══════════════════════════════════════════ the scanner stays INACTIVE (ruled)

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(jsx?|tsx?)$/.test(e)) out.push(p);
  }
  return out;
}
function resolveImport(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.js`, `${base}.jsx`, `${base}.ts`, `${base}.tsx`, path.join(base, "index.js")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}
/** Every src file a scan screen can reach through static or dynamic relative imports. */
function reachableFromScanner() {
  const seen = new Set();
  const stack = walk(path.join(APP, "src/modules/scan"));
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
      const r = resolveImport(f, m[1]);
      if (r && !seen.has(r)) stack.push(r);
    }
  }
  return seen;
}

describe("PART_IDENTIFIER_TRANSPORT_READY stays false while the client scanner path calls Firebase", () => {
  it("the scanner still reaches Firebase callables, so the identifier transport is false in every environment and in tests", () => {
    const firebaseReachers = [...reachableFromScanner()]
      .filter((f) => /from\s+["']firebase\/functions["']|httpsCallable\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(APP, f));
    // The condition of the pin. When the scanner no longer reaches Firebase, this pin is re-decided -- not before.
    expect(firebaseReachers.length).toBeGreaterThan(0);

    const registry = JSON.parse(read("config/environments.json"));
    const flipped = registry.environments
      .filter((env) => (env.readiness ?? {}).PART_IDENTIFIER_TRANSPORT_READY !== false)
      .map((env) => env.id);
    expect(flipped).toEqual([]);
    expect(readFileSync(path.join(APP, "vitest.config.js"), "utf8")).toMatch(/PART_IDENTIFIER_TRANSPORT_READY:\s*false/);
    // And the alias MUTATIONS behind that transport are held besides: lifting readiness would still change nothing.
    expect(CATALOG_MUTATION_HOLD.held).toBe(true);
  });
});
