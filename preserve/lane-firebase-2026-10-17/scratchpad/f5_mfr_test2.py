from ed import edit
edit("test/manufacturersMetadataList.test.jsx", [
("""vi.mock("../src/services/manufacturerQueries", () => ({ fetchManufacturerList: vi.fn() }));

import { fetchManufacturerList } from "../src/services/manufacturerQueries";""",
"""vi.mock("../src/services/manufacturerQueries", () => ({ fetchManufacturerList: vi.fn() }));
// The Catalog API seam the manufacturer client calls (F5); no network.
vi.mock("../src/services/catalogApiClient.js", () => ({ catalogApiClient: { call: vi.fn() } }));

import { fetchManufacturerList } from "../src/services/manufacturerQueries";
import { catalogApiClient } from "../src/services/catalogApiClient.js";
import { fetchManufacturerCatalog, manufacturerCommands, manufacturerWriteOutcome } from "../src/services/manufacturerCatalogClient.js";"""),
])
s = open("test/manufacturersMetadataList.test.jsx", encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
s = s.rstrip("\r\n") + (nl + nl + """describe("manufacturerCatalogClient -- the Catalog API, not a Firebase callable (Firebase exit F5)", () => {
  it("lists through listManufacturers and maps id -> manufacturerId, carrying updatedAt and truncated", async () => {
    catalogApiClient.call.mockResolvedValue({ ok: true, result: { truncated: true, manufacturers: [{ id: "m1", name: "Taylor", status: "ACTIVE", provenance: "NATIVE", updatedAt: "t1" }] } });
    const { result } = await fetchManufacturerCatalog();
    expect(catalogApiClient.call).toHaveBeenCalledWith("listManufacturers");
    expect(result).toEqual({ status: "ready", excludedCount: 0, truncated: true, manufacturers: [{ manufacturerId: "m1", name: "Taylor", status: "ACTIVE", updatedAt: "t1" }] });
  });

  it("a FORBIDDEN list is denied; anything else that fails is unavailable, never empty", async () => {
    catalogApiClient.call.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    expect(await fetchManufacturerCatalog()).toEqual({ errorStatus: "denied" });
    catalogApiClient.call.mockResolvedValue({ ok: false, code: "UNREACHABLE" });
    expect(await fetchManufacturerCatalog()).toEqual({ errorStatus: "unavailable" });
  });

  it("the three writes send the writer's own envelopes", async () => {
    catalogApiClient.call.mockResolvedValue({ ok: true, result: { manufacturerId: "m1", updatedAt: "t2", replayed: false } });
    expect(await manufacturerCommands.create({ manufacturerId: "m1", name: "Taylor" })).toMatchObject({ kind: "applied" });
    expect(catalogApiClient.call).toHaveBeenLastCalledWith("createManufacturer", { manufacturer: { manufacturerId: "m1", name: "Taylor" } });
    await manufacturerCommands.rename({ manufacturerId: "m1", expectedUpdatedAt: "t1", name: "T" });
    expect(catalogApiClient.call).toHaveBeenLastCalledWith("updateManufacturer", { manufacturerId: "m1", expectedUpdatedAt: "t1", name: "T" });
    await manufacturerCommands.changeStatus({ manufacturerId: "m1", expectedUpdatedAt: "t1", newStatus: "INACTIVE" });
    expect(catalogApiClient.call).toHaveBeenLastCalledWith("changeManufacturerStatus", { manufacturerId: "m1", expectedUpdatedAt: "t1", newStatus: "INACTIVE" });
  });

  it("manufacturerWriteOutcome: a replay says so, a refusal is named, and nothing unknown becomes success", () => {
    expect(manufacturerWriteOutcome({ ok: true, result: { replayed: true } }).kind).toBe("replayed");
    expect(manufacturerWriteOutcome({ ok: false, code: "FORBIDDEN" }).kind).toBe("denied");
    expect(manufacturerWriteOutcome({ ok: false, code: "CONFLICT" }).kind).toBe("conflict");
    expect(manufacturerWriteOutcome({ ok: false, code: "CATALOG_MUTATION_HELD" }).kind).toBe("error");
    expect(manufacturerWriteOutcome(undefined).kind).toBe("error");
  });
});
""").replace("\n", nl)
open("test/manufacturersMetadataList.test.jsx", "w", encoding="utf-8", newline="").write(s)
edit("test/manufacturerQueries.test.mjs", [
("""test("manufacturerQueries.js reads exclusively through the trusted getManufacturerCatalog client seam", () => {
  assert.match(src, /fetchManufacturerCatalog/);
  assert.match(src, /manufacturerReadCallableClient/);
});""",
"""test("manufacturerQueries.js reads exclusively through the EOS Catalog API client seam (Firebase exit F5)", () => {
  assert.match(src, /fetchManufacturerCatalog/);
  assert.match(src, /manufacturerCatalogClient/);
});"""),
])
