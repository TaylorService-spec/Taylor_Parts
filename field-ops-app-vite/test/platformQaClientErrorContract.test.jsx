// PLATFORM QA (lane L5) -- CLIENT x SERVER ERROR CONTRACT, one matrix over the three status-mapping EOS clients.
//
// Each client maps an HTTP status (and, first, a few server codes) to the failure CATEGORY a screen renders. A governed
// refusal the SERVER can emit must reach the screen as a refusal, never as INTERNAL ("something broke") -- otherwise
// a Precondition or a Conflict the user can act on is presented as a platform fault. This file derives, from each
// server transport's SOURCE, every status that transport can emit, and asks the client's own category function about
// each one. Known divergences are pinned so a change in either direction is observed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { commercialFailureCategory } from "../src/services/commercialApiClient.js";
import { operationsFailureCategory } from "../src/services/operationsApiClient.js";
import { workforceFailureCategory } from "../src/services/workforceApiClient.js";
import { reorderFailureCategory } from "../src/services/reorderApiClient.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

/** Every numeric HTTP status literal a transport source can answer with: its STATUS_BY_* map plus its direct failures. */
function emittableStatuses(source) {
  const statuses = new Set();
  const map = source.slice(source.indexOf("STATUS_BY_"), source.indexOf("});", source.indexOf("STATUS_BY_")));
  for (const m of map.matchAll(/:\s*(\d{3})/g)) statuses.add(Number(m[1]));
  for (const m of source.matchAll(/(?:failure|json)\((\d{3}),/g)) statuses.add(Number(m[1]));
  for (const m of source.matchAll(/status:\s*(\d{3})/g)) statuses.add(Number(m[1]));
  return [...statuses].filter((s) => s >= 400).sort();
}

const CLIENTS = {
  commercial: { server: "../functions/src/eosCommercial/commercialHttp.ts", category: commercialFailureCategory },
  operations: { server: "../functions/src/eosOps/eosOpsHttp.ts", category: operationsFailureCategory },
  workforce: { server: "../functions/src/eosWorkforce/workforceHttp.ts", category: workforceFailureCategory },
};

describe("client x server error contract", () => {
  const grid = {};
  for (const [name, { server, category }] of Object.entries(CLIENTS)) {
    grid[name] = Object.fromEntries(emittableStatuses(read(server)).map((s) => [s, category(s, s === 405 ? "METHOD_NOT_ALLOWED" : "SOME_DOMAIN_CODE")]));
  }

  it("derives a non-trivial status set from every server transport", () => {
    for (const name of Object.keys(CLIENTS)) {
      expect(Object.keys(grid[name]).map(Number)).toEqual(expect.arrayContaining([400, 401, 403, 404, 500]));
    }
  });

  it("a 401 / 403 / 404 is never rendered as INTERNAL by any client", () => {
    for (const name of Object.keys(CLIENTS)) {
      expect([grid[name][401], grid[name][403], grid[name][404]]).not.toContain("INTERNAL");
    }
  });

  it("the full grid, pinned", () => {
    // Re-measured on main e2dac914. L5-F08 is FIXED on main: the Commercial client now maps 409 CONFLICT, 412
    // PRECONDITION_FAILED and 503 UNAVAILABLE. The Operations transport (PR #2000) now also carries the Reorder
    // operations and emits 409 CONFLICT and -- since the L5 alignment -- 412 PRECONDITION_FAILED; the generic
    // operationsApiClient serves only the two principal-context reads, which emit neither, so its INTERNAL for 409/412
    // is latent. The Reorder operations use reorderApiClient, which maps 409 and 412 (asserted below).
    // INTEGRATION RE-MEASURE (L1+L2+L3+L5, 2026-09-29): lane L3's inventory command routes (/operations/cycle-count,
    // /relocation, /transfer, /placement, /serialized-asset) add 503 NOT_ACTIVATED while their writers are INACTIVE.
    // The generic operationsApiClient never calls those routes, so its INTERNAL for 503 is latent too; the acquire
    // client carries the server's code through (serializedAssetAcquireCallableClient.js).
    expect(grid).toEqual({
      commercial: { 400: "INVALID_INPUT", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "UNKNOWN_OPERATION",
        409: "CONFLICT", 412: "PRECONDITION_FAILED", 413: "INVALID_INPUT", 500: "INTERNAL", 503: "UNAVAILABLE" },
      operations: { 400: "INVALID_INPUT", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "UNKNOWN_OPERATION",
        409: "INTERNAL", 412: "INTERNAL", 500: "INTERNAL", 503: "INTERNAL" },
      workforce: { 400: "INVALID_INPUT", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "UNKNOWN_OPERATION",
        409: "CONFLICT", 412: "PRECONDITION_FAILED", 413: "INVALID_INPUT", 500: "INTERNAL" },
    });
  });

  it("the Reorder client covers every status the Operations transport emits for the Reorder operations", () => {
    const statuses = emittableStatuses(read("../functions/src/eosOps/eosOpsHttp.ts"));
    const mapped = Object.fromEntries(statuses.map((s) => [s, reorderFailureCategory(s, s === 405 ? "UNKNOWN_OPERATION" : "SOME_DOMAIN_CODE")]));
    expect(mapped[409]).toBe("CONFLICT");
    expect(mapped[412]).toBe("PRECONDITION_FAILED");
    expect(Object.entries(mapped).filter(([s, c]) => Number(s) < 500 && c === "INTERNAL")).toEqual([]);
  });
});
