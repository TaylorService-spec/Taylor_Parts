// RACKING LAYOUT GENERATOR — the pure proposal builder.
//
// Every assertion here is about STRUCTURE and the deterministic key. Nothing here decides whether a
// proposal is creatable: that verdict belongs to the trusted `previewBinCreates` read, and a test
// that let this module claim it would be testing a lie.
import { describe, expect, test } from "vitest";
import {
  generateRackingLayout,
  binIdempotencyKey,
  normalizeArea,
  normalizeAisle,
  oddPositions,
  resolveAisles,
  toCreateRequest,
  PROPOSAL_STATE,
} from "../src/domain/rackingLayoutGenerator.js";

const base = {
  warehouseId: "WH-1",
  area: "PARTS_ROOM",
  aisles: { mode: "range", from: "A", to: "B" },
  defaultBayCount: 2,
  defaultPositionCount: 2,
};
const at = (rows, aisle, bay) => rows.filter((r) => r.aisle === aisle && r.bay === bay);

describe("aisle resolution", () => {
  test("a range expands inclusively", () => {
    expect(resolveAisles({ mode: "range", from: "A", to: "D" }).aisles).toEqual(["A", "B", "C", "D"]);
  });

  test("a two-letter range carries across the letter boundary", () => {
    expect(resolveAisles({ mode: "range", from: "AY", to: "BB" }).aisles).toEqual(["AY", "AZ", "BA", "BB"]);
  });

  test("a range of mixed widths is refused rather than guessed at", () => {
    const r = resolveAisles({ mode: "range", from: "A", to: "AF" });
    expect(r).toMatchObject({ ok: false, reason: "aisle_range_width_mismatch" });
  });

  test("a reversed range is refused rather than silently emptied", () => {
    expect(resolveAisles({ mode: "range", from: "D", to: "A" })).toMatchObject({ ok: false, reason: "aisle_range_reversed" });
  });

  test("an explicit list keeps its gaps, because real racking skips letters", () => {
    expect(resolveAisles({ mode: "explicit", list: "A, B, D, F" }).aisles).toEqual(["A", "B", "D", "F"]);
  });

  test("an explicit list accepts an array as readily as a string", () => {
    expect(resolveAisles({ mode: "explicit", list: ["a", "c"] }).aisles).toEqual(["A", "C"]);
  });

  test("an empty explicit list is an error, not an empty layout", () => {
    expect(resolveAisles({ mode: "explicit", list: "  ,  " })).toMatchObject({ ok: false, reason: "aisle_required" });
  });

  test("an aisle outside the governed shape is refused", () => {
    expect(resolveAisles({ mode: "explicit", list: "A1" })).toMatchObject({ ok: false, reason: "aisle_invalid" });
  });
});

describe("normalization mirrors the server, visibly and before sending", () => {
  test("an area is upper-cased and its spaces become underscores", () => {
    expect(normalizeArea("  parts room ")).toBe("PARTS_ROOM");
  });

  test("an aisle is upper-cased with its whitespace removed", () => {
    expect(normalizeAisle(" a b ")).toBe("AB");
  });

  test("normalized input generates the same rows as pre-normalized input", () => {
    const typed = generateRackingLayout({ ...base, area: "parts room" });
    const canonical = generateRackingLayout(base);
    expect(typed.rows).toEqual(canonical.rows);
  });
});

describe("positions default to odd numbers, but nothing enforces parity", () => {
  test("N positions render as 1, 3, 5 ... 2N-1", () => {
    expect(oddPositions(4)).toEqual([1, 3, 5, 7]);
  });

  test("the generator uses odd positions by default", () => {
    const { rows } = generateRackingLayout({ ...base, defaultPositionCount: 3 });
    expect(at(rows, "A", 1).map((r) => r.position)).toEqual([1, 3, 5]);
  });

  test("an explicit list may insert an even position between two odd ones", () => {
    const { rows } = generateRackingLayout({
      ...base,
      aisles: { mode: "explicit", list: "A" },
      defaultBayCount: 1,
      explicitPositions: { "A:1": [1, 2, 3] },
    });
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.state === PROPOSAL_STATE.PROPOSED)).toBe(true);
  });
});

describe("the rack is not uniform", () => {
  test("bay count varies by aisle", () => {
    const { rows } = generateRackingLayout({ ...base, bayCountByAisle: { B: 4 } });
    expect(new Set(rows.filter((r) => r.aisle === "A").map((r) => r.bay))).toEqual(new Set([1, 2]));
    expect(new Set(rows.filter((r) => r.aisle === "B").map((r) => r.bay))).toEqual(new Set([1, 2, 3, 4]));
  });

  test("position count varies by aisle, then by bay, most specific winning", () => {
    const { rows } = generateRackingLayout({
      ...base,
      positionCountByAisle: { A: 3 },
      positionCountByBay: { "A:2": 1 },
    });
    expect(at(rows, "A", 1)).toHaveLength(3);
    expect(at(rows, "A", 2)).toHaveLength(1);
    expect(at(rows, "B", 1)).toHaveLength(2); // falls back to the default
  });

  test("an explicit position list overrides every count", () => {
    const { rows } = generateRackingLayout({
      ...base,
      positionCountByBay: { "A:1": 9 },
      explicitPositions: { "A:1": [7] },
    });
    expect(at(rows, "A", 1).map((r) => r.position)).toEqual([7]);
  });
});

describe("the deterministic Administration key", () => {
  test("the key is namespaced, versioned and fully structured", () => {
    expect(binIdempotencyKey({ warehouseId: "WH-1", area: "PARTS_ROOM", aisle: "A", bay: 1, position: 3 }))
      .toBe("binadm:v1:WH-1:PARTS_ROOM:A:1:3");
  });

  test("the same rack described twice yields identical keys, so a retry replays", () => {
    expect(generateRackingLayout(base).rows.map((r) => r.idempotencyKey))
      .toEqual(generateRackingLayout(base).rows.map((r) => r.idempotencyKey));
  });

  test("a hand-added bin and a generated one converge on one key, and therefore one bin", () => {
    const generated = generateRackingLayout(base).rows.find((r) => r.aisle === "A" && r.bay === 1 && r.position === 1);
    expect(binIdempotencyKey({ warehouseId: "WH-1", area: "PARTS_ROOM", aisle: "A", bay: 1, position: 1 }))
      .toBe(generated.idempotencyKey);
  });

  test("the key excludes the rendered code, the name and the status", () => {
    const key = binIdempotencyKey({ warehouseId: "WH-1", area: "PARTS_ROOM", aisle: "A", bay: 1, position: 3 });
    expect(key).not.toContain("A01-003");
    expect(key).not.toContain("ACTIVE");
  });

  test("a different warehouse is a different bin", () => {
    const a = generateRackingLayout(base).rows[0].idempotencyKey;
    const b = generateRackingLayout({ ...base, warehouseId: "WH-2" }).rows[0].idempotencyKey;
    expect(a).not.toBe(b);
  });
});

describe("what the generator refuses to do", () => {
  test("it never authors a binId or a code", () => {
    const row = generateRackingLayout(base).rows[0];
    expect(row).not.toHaveProperty("binId");
    expect(row).not.toHaveProperty("code");
    expect(Object.keys(toCreateRequest(row)).sort())
      .toEqual(["aisle", "area", "bay", "idempotencyKey", "position", "warehouseId"]);
  });

  test("it never proposes a quantity, an owner or a status", () => {
    const row = generateRackingLayout(base).rows[0];
    for (const forbidden of ["quantity", "onHand", "partId", "status", "ownerId"]) {
      expect(row).not.toHaveProperty(forbidden);
    }
  });

  test("a missing warehouse or a malformed area produces errors and no rows", () => {
    expect(generateRackingLayout({ ...base, warehouseId: "" })).toMatchObject({ ok: false, rows: [] });
    expect(generateRackingLayout({ ...base, area: "1BAD" }).errors).toContain("area_invalid");
  });

  test("a duplicate within one request is marked, not silently collapsed", () => {
    const { rows } = generateRackingLayout({
      ...base,
      aisles: { mode: "explicit", list: "A, A" },
      defaultBayCount: 1,
      defaultPositionCount: 1,
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.state)).toEqual([PROPOSAL_STATE.PROPOSED, PROPOSAL_STATE.DUPLICATE]);
  });

  test("a non-integer position is marked INVALID and carries no key", () => {
    const { rows } = generateRackingLayout({
      ...base,
      aisles: { mode: "explicit", list: "A" },
      defaultBayCount: 1,
      explicitPositions: { "A:1": [1, "two"] },
    });
    expect(rows[1]).toMatchObject({ state: PROPOSAL_STATE.INVALID, idempotencyKey: null });
  });

  test("zero bays or zero positions is an empty layout, not an error", () => {
    expect(generateRackingLayout({ ...base, defaultBayCount: 0 })).toMatchObject({ ok: true, rows: [] });
    expect(generateRackingLayout({ ...base, defaultPositionCount: 0 }).rows).toEqual([]);
  });
});

describe("the generator is pure", () => {
  test("it does not mutate its input", () => {
    const input = { ...base, bayCountByAisle: { A: 2 } };
    const snapshot = JSON.stringify(input);
    generateRackingLayout(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("row count is exactly aisles x bays x positions", () => {
    const { rows } = generateRackingLayout({ ...base, aisles: { mode: "range", from: "A", to: "C" }, defaultBayCount: 3, defaultPositionCount: 4 });
    expect(rows).toHaveLength(3 * 3 * 4);
  });
});
