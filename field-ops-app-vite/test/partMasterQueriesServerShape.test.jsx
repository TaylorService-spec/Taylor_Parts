// Proven under vitest (the service imports extensionless modules, as the app's bundler resolves them).
import { test, expect } from "vitest";
const expect_equal = (a, b) => expect(a).toBe(b);
const expect_deep = (a, b) => expect(a).toEqual(b);

test("a Part exactly as the Render catalog serves it (id, no partId) composes as VALID through every view read", async () => {
  // catalogRows.ts partFromRow carries identity as `id` only. The view gate requires partId === the document id, so
  // an unmapped server record would be classed malformed -- every PostgreSQL-served Part "invalid", every consumer
  // blocked. The component suites mock this module and never exercise the mapping; this proves it directly.
  const { readPartsForView, searchParts } = await import("../src/services/partMasterQueries.js");
  const serverPart = {
    id: "PART-7", internalPartNumber: "IPN-7", name: "Condenser fan motor", description: null, category: null,
    status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED",
    expiryTracked: false, consumable: false, returnableCore: false, primaryManufacturerId: null,
    primaryManufacturerPartNumber: null, oemStatus: null, wholeUnit: false, equipmentModelId: null,
    version: 1, createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z",
  };
  const client = { call: async (op) => (op === "readPartsByIds" ? { ok: true, result: [serverPart] }
    : { ok: true, result: { parts: [serverPart], nextCursor: null } }) };
  for (const res of [await readPartsForView(["PART-7"], { client }), await searchParts({ limit: 10 }, { client })]) {
    expect_equal(res.ok, true);
    expect_deep(res.invalid, [], "a Render-served Part must not be classed malformed");
    expect_equal(res.parts.length, 1);
    expect_equal(res.parts[0].partId, "PART-7");
  }
  // A record that STATES a different partId is still refused -- the mapping fills an absence, it never overrides.
  const lying = { call: async () => ({ ok: true, result: [{ ...serverPart, partId: "OTHER" }] }) };
  const refused = await readPartsForView(["PART-7"], { client: lying });
  expect_equal(refused.parts.length, 0);
  expect_equal(refused.invalid.length, 1);
});
