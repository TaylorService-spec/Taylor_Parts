// BIN LABEL — the pure projection, the scan token, and the CSV.
//
// The load-bearing test in this file is the round trip: the token this module builds must survive
// the SHARED scan normalizer untouched and come back as the stable binId. If that ever breaks, every
// label already stuck to a shelf in the warehouse stops resolving — so it is proved against the real
// parser, never against a copy of its regex.
import { describe, expect, test } from "vitest";
import {
  toBinScanToken,
  buildBinLabel,
  buildBinLabels,
  sortBinLabels,
  labelsToCsv,
  binLabelCsvFilename,
  BIN_LABEL_CSV_COLUMNS,
  BIN_SCAN_TOKEN_PREFIX,
} from "../src/domain/binLabel.js";
import { normalizeScanToken, resolveScannedIdentity } from "../src/domain/scannedIdentity.js";

const BIN_ID = "bin_5f3a9c2e1d4b6a8f0c3e5d7b9a1f2e4c6d8b0a2f";
const bin = (over = {}) => ({
  binId: BIN_ID, code: "A01-003", name: null, status: "ACTIVE",
  area: "PARTS_ROOM", aisle: "A", bay: 1, position: 3, ...over,
});
const WAREHOUSE = { id: "WH-1", name: "Phoenix" };

describe("machine identity is the binId, and survives everything the human code does not", () => {
  test("the token is the shared EOS-LOC prefix plus the stable binId", () => {
    expect(toBinScanToken(BIN_ID)).toBe(`${BIN_SCAN_TOKEN_PREFIX}${BIN_ID}`);
    expect(toBinScanToken(BIN_ID)).toBe(`EOS-LOC:${BIN_ID}`);
  });

  test("the token round-trips through the REAL shared normalizer back to the binId", () => {
    expect(normalizeScanToken(toBinScanToken(BIN_ID))).toBe(BIN_ID);
  });

  test("the normalized token resolves as a canonical BIN location reference", () => {
    // The client half of the round trip the trusted resolveBinFromToken completes server-side.
    const result = resolveScannedIdentity(toBinScanToken(BIN_ID), {
      locations: [{ locationId: BIN_ID, type: "BIN" }],
    });
    expect(result.entityType).toBe("INVENTORY_LOCATION");
    expect(result.canonicalIdentity).toEqual({ type: "BIN", locationId: BIN_ID });
  });

  test("the visible code does not appear in the machine token", () => {
    expect(toBinScanToken(BIN_ID)).not.toContain("A01-003");
  });

  test("a rename changes the visible code and leaves the machine token identical", () => {
    const before = buildBinLabel(bin());
    const after = buildBinLabel(bin({ code: "B02-007" }));
    expect(after.canonicalCode).not.toBe(before.canonicalCode);
    expect(after.machineToken).toBe(before.machineToken);
  });

  test("the same binId always produces the same token, so a reprint is identical", () => {
    expect(toBinScanToken(BIN_ID)).toBe(toBinScanToken(BIN_ID));
  });

  test("two bins at the same structured place but different ids get different tokens", () => {
    expect(toBinScanToken("bin_aaa")).not.toBe(toBinScanToken("bin_bbb"));
  });
});

describe("the label projection", () => {
  test("one governed bin becomes one label carrying the server's own code", () => {
    const label = buildBinLabel(bin(), WAREHOUSE);
    expect(label.canonicalCode).toBe("A01-003");
    expect(label.area).toBe("PARTS_ROOM");
    expect(label.warehouseName).toBe("Phoenix");
    expect(label.machineToken).toBe(toBinScanToken(BIN_ID));
  });

  test("a missing warehouse is absent context, not an error", () => {
    const label = buildBinLabel(bin());
    expect(label.warehouseId).toBeNull();
    expect(label.warehouseName).toBeNull();
  });

  test("it carries no quantity, no identity internals and no claim data", () => {
    const label = buildBinLabel(bin(), WAREHOUSE);
    for (const forbidden of [
      "quantity", "onHand", "available", "reserved", "expectedQuantity", "valuation",
      "idempotencyKey", "fingerprint", "claim", "claimState", "version", "createdBy",
    ]) {
      expect(label).not.toHaveProperty(forbidden);
    }
  });

  test("inactive status is preserved truthfully, never normalized away", () => {
    expect(buildBinLabel(bin({ status: "INACTIVE" })).status).toBe("INACTIVE");
  });

  test("the projection is frozen — a caller cannot quietly rewrite a label", () => {
    const label = buildBinLabel(bin());
    expect(Object.isFrozen(label)).toBe(true);
  });
});

describe("ordering is total, and numeric where it counts", () => {
  const rows = [
    bin({ binId: "bin_c", aisle: "A", bay: 10, position: 1, code: "A10-001" }),
    bin({ binId: "bin_a", aisle: "A", bay: 2, position: 3, code: "A02-003" }),
    bin({ binId: "bin_b", aisle: "A", bay: 2, position: 1, code: "A02-001" }),
  ];

  test("bay sorts numerically — 2 before 10, which a string sort gets backwards", () => {
    const codes = buildBinLabels(rows).map((l) => l.canonicalCode);
    expect(codes).toEqual(["A02-001", "A02-003", "A10-001"]);
  });

  test("area then aisle then bay then position, in that order", () => {
    const labels = buildBinLabels([
      bin({ binId: "b1", area: "ZONE_B", aisle: "A", bay: 1, position: 1 }),
      bin({ binId: "b2", area: "ZONE_A", aisle: "B", bay: 1, position: 1 }),
    ]);
    expect(labels.map((l) => l.area)).toEqual(["ZONE_A", "ZONE_B"]);
  });

  test("binId breaks a full tie, so the order is total and repeatable", () => {
    const same = (id) => bin({ binId: id });
    const a = sortBinLabels([same("bin_z"), same("bin_a")].map((b) => buildBinLabel(b)));
    expect(a.map((l) => l.binId)).toEqual(["bin_a", "bin_z"]);
  });

  test("sorting does not mutate its input", () => {
    const labels = [buildBinLabel(bin({ binId: "bin_z" })), buildBinLabel(bin({ binId: "bin_a" }))];
    const order = labels.map((l) => l.binId);
    sortBinLabels(labels);
    expect(labels.map((l) => l.binId)).toEqual(order);
  });
});

describe("in-use bins by default", () => {
  const mixed = [bin({ binId: "bin_1" }), bin({ binId: "bin_2", status: "INACTIVE" })];

  test("inactive bins are excluded unless asked for", () => {
    expect(buildBinLabels(mixed).map((l) => l.binId)).toEqual(["bin_1"]);
  });

  test("including them is explicit, and their status survives", () => {
    const all = buildBinLabels(mixed, { includeInactive: true });
    expect(all).toHaveLength(2);
    expect(all.find((l) => l.binId === "bin_2").status).toBe("INACTIVE");
  });

  test("an empty warehouse produces an empty list, not an error", () => {
    expect(buildBinLabels([])).toEqual([]);
  });
});

describe("CSV", () => {
  const labels = buildBinLabels([bin(), bin({ binId: "bin_2", code: "A01-005", position: 5 })], { warehouse: WAREHOUSE });

  test("the header is exactly the specified columns", () => {
    expect(labelsToCsv(labels).split("\r\n")[0])
      .toBe("warehouseId,binId,area,aisle,bay,position,code,scanToken,status");
    expect(BIN_LABEL_CSV_COLUMNS).toHaveLength(9);
  });

  test("the scan token and code columns are exact", () => {
    const row = labelsToCsv(labels).split("\r\n")[1].split(",");
    expect(row[6]).toBe("A01-003");
    expect(row[7]).toBe(toBinScanToken(BIN_ID));
  });

  test("rows follow the same deterministic order as the preview", () => {
    const codes = labelsToCsv(labels).split("\r\n").slice(1, 3).map((r) => r.split(",")[6]);
    expect(codes).toEqual(["A01-003", "A01-005"]);
  });

  test("the same input exported twice is byte-identical", () => {
    expect(labelsToCsv(labels)).toBe(labelsToCsv(labels));
  });

  test("there is no timestamp in the body, so two exports can be diffed", () => {
    expect(labelsToCsv(labels)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test("no quantity column exists", () => {
    const header = labelsToCsv(labels).split("\r\n")[0];
    for (const q of ["quantity", "onHand", "available", "reserved"]) {
      expect(header).not.toContain(q);
    }
  });

  test("the free-form name is not exported at all", () => {
    const csv = labelsToCsv(buildBinLabels([bin({ name: "Fast movers" })], { warehouse: WAREHOUSE }));
    expect(csv).not.toContain("Fast movers");
    expect(csv.split("\r\n")[0]).not.toContain("name");
  });

  test("RFC 4180 quoting: commas and quotes are escaped rather than breaking the row", () => {
    const csv = labelsToCsv([{ ...buildBinLabel(bin()), warehouseName: null, area: 'ODD,"AREA"' }]);
    expect(csv).toContain('"ODD,""AREA"""');
    // The embedded comma stayed inside its field: still exactly one data row.
    expect(csv.split("\r\n").filter((line) => line !== "")).toHaveLength(2);
  });

  test("a spreadsheet formula is neutralized rather than trusted", () => {
    const csv = labelsToCsv([{ ...buildBinLabel(bin()), area: "=SUM(A1:A9)" }]);
    expect(csv).toContain("'=SUM(A1:A9)");
    expect(csv).not.toMatch(/,=SUM/);
  });

  test("every dangerous leading character is guarded, not just the equals sign", () => {
    for (const bad of ["=cmd", "+1", "-1", "@x"]) {
      expect(labelsToCsv([{ ...buildBinLabel(bin()), area: bad }])).toContain(`'${bad}`);
    }
  });

  test("an empty label set still produces a valid header-only file", () => {
    expect(labelsToCsv([])).toBe("warehouseId,binId,area,aisle,bay,position,code,scanToken,status\r\n");
  });
});

describe("filename safety", () => {
  test("a normal warehouse id becomes a predictable filename", () => {
    expect(binLabelCsvFilename("WH-1")).toBe("bin-labels-wh-1.csv");
  });

  test("path separators and traversal cannot survive", () => {
    const name = binLabelCsvFilename("../../etc/passwd");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(name).not.toContain("..");
  });

  test("a blank or missing id still yields a usable filename", () => {
    expect(binLabelCsvFilename("")).toBe("bin-labels-warehouse.csv");
    expect(binLabelCsvFilename(undefined)).toBe("bin-labels-warehouse.csv");
  });

  test("the name is bounded, so no absurd id becomes an absurd filename", () => {
    expect(binLabelCsvFilename("W".repeat(500)).length).toBeLessThan(90);
  });
});
