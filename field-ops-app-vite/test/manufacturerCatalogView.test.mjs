import test from "node:test";
import assert from "node:assert/strict";
import {
  MANUFACTURER_CATALOG_VIEW_STATE,
  manufacturerCatalogViewState,
  manufacturerNameById,
  manufacturerPickerOptions,
} from "../src/domain/manufacturerCatalogView.js";

test("manufacturerCatalogViewState: loading takes priority over everything else", () => {
  assert.equal(manufacturerCatalogViewState({ loading: true, errorStatus: "denied", result: null }), MANUFACTURER_CATALOG_VIEW_STATE.LOADING);
});

test("manufacturerCatalogViewState: denied is distinct from unavailable -- DENIED never renders as EMPTY/UNAVAILABLE", () => {
  assert.equal(manufacturerCatalogViewState({ loading: false, errorStatus: "denied", result: null }), MANUFACTURER_CATALOG_VIEW_STATE.DENIED);
});

test("manufacturerCatalogViewState: any other error, or a null result, is UNAVAILABLE, never a false-empty READY", () => {
  assert.equal(manufacturerCatalogViewState({ loading: false, errorStatus: "unavailable", result: null }), MANUFACTURER_CATALOG_VIEW_STATE.UNAVAILABLE);
  assert.equal(manufacturerCatalogViewState({ loading: false, errorStatus: null, result: null }), MANUFACTURER_CATALOG_VIEW_STATE.UNAVAILABLE);
});

test("manufacturerCatalogViewState: a real, even empty, result is READY", () => {
  assert.equal(manufacturerCatalogViewState({ loading: false, errorStatus: null, result: { status: "ready", manufacturers: [], excludedCount: 0 } }), MANUFACTURER_CATALOG_VIEW_STATE.READY);
});

test("manufacturerNameById builds an id->name map, ignores malformed entries, empty for non-array input", () => {
  const map = manufacturerNameById([{ manufacturerId: "MFG-1", name: "Acme" }, { manufacturerId: "MFG-2" }, null]);
  assert.equal(map.get("MFG-1"), "Acme");
  assert.equal(map.has("MFG-2"), false);
  assert.equal(manufacturerNameById(null).size, 0);
  assert.equal(manufacturerNameById(undefined).size, 0);
});

test("manufacturerPickerOptions only offers ACTIVE manufacturers, sorted by name", () => {
  const opts = manufacturerPickerOptions([
    { manufacturerId: "MFG-2", name: "Zeta", status: "ACTIVE" },
    { manufacturerId: "MFG-1", name: "Acme", status: "ACTIVE" },
    { manufacturerId: "MFG-3", name: "Inactive Co", status: "INACTIVE" },
  ]);
  assert.deepEqual(opts, [
    { value: "MFG-1", label: "Acme" },
    { value: "MFG-2", label: "Zeta" },
  ]);
});
