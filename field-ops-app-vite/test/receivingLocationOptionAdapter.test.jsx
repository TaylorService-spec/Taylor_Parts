// EI Receiving -- focused tests for the PURE receivingLocationOptionAdapter (vitest). The module
// is pure logic (no Firebase/DOM); this file is placed under test/ with a .test.jsx extension so
// the existing vitest runner (test:components) auto-discovers it -- it contains no JSX/rendering.
import { describe, it, expect } from "vitest";
import { adaptReceivingLocationOptions, isBackendValidIdSegment, RECEIVING_LOCATION_TYPE, __test__ } from "../src/domain/receivingLocationOptionAdapter.js";

const OK = (value, label) => ({ value, label, type: "WAREHOUSE" });

describe("adaptReceivingLocationOptions -- non-array input fails closed", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["object", { value: "A", label: "A", type: "WAREHOUSE" }],
    ["string", "WAREHOUSE"],
    ["number", 42],
    ["boolean", true],
    ["a Set", new Set()],
  ])("%s -> { ok:false, options:[] }", (_l, input) => {
    expect(adaptReceivingLocationOptions(input)).toEqual({ ok: false, options: [] });
  });
});

describe("adaptReceivingLocationOptions -- valid payloads", () => {
  it("empty array is the only honest empty success", () => {
    expect(adaptReceivingLocationOptions([])).toEqual({ ok: true, options: [] });
  });

  it("a fully-valid array returns sanitized options", () => {
    const r = adaptReceivingLocationOptions([OK("WH-1", "Central")]);
    expect(r.ok).toBe(true);
    expect(r.options).toEqual([{ value: "WH-1", label: "Central", type: "WAREHOUSE" }]);
  });

  it("trims the label for display but never trims the value", () => {
    const r = adaptReceivingLocationOptions([OK("WH-1", "  Central  ")]);
    expect(r.options[0].label).toBe("Central");
    expect(r.options[0].value).toBe("WH-1");
  });

  it("orders deterministically by label, then value", () => {
    const r = adaptReceivingLocationOptions([
      OK("WH-3", "Bravo"),
      OK("WH-2", "Alpha"),
      OK("WH-1", "Alpha"), // same label -> value tiebreak
    ]);
    expect(r.options.map((o) => `${o.label}:${o.value}`)).toEqual(["Alpha:WH-1", "Alpha:WH-2", "Bravo:WH-3"]);
  });

  it("re-orders input regardless of its given order (stable, deterministic)", () => {
    const a = adaptReceivingLocationOptions([OK("b", "B"), OK("a", "A")]);
    const b = adaptReceivingLocationOptions([OK("a", "A"), OK("b", "B")]);
    expect(a).toEqual(b);
    expect(a.options.map((o) => o.label)).toEqual(["A", "B"]);
  });
});

describe("adaptReceivingLocationOptions -- exact keys + type", () => {
  it.each([
    ["missing type", { value: "A", label: "A" }],
    ["missing label", { value: "A", type: "WAREHOUSE" }],
    ["missing value", { label: "A", type: "WAREHOUSE" }],
    ["extra key", { value: "A", label: "A", type: "WAREHOUSE", extra: 1 }],
    ["non-object row", "A"],
    ["null row", null],
    ["array row", ["A"]],
  ])("%s -> whole payload fails closed", (_l, row) => {
    expect(adaptReceivingLocationOptions([row])).toEqual({ ok: false, options: [] });
  });

  it.each([
    ["BIN", "BIN"],
    ["lowercase warehouse", "warehouse"],
    ["empty", ""],
    ["MOBILE", "MOBILE"],
  ])("type %s (not exactly WAREHOUSE) -> fails closed", (_l, type) => {
    expect(adaptReceivingLocationOptions([{ value: "A", label: "A", type }])).toEqual({ ok: false, options: [] });
  });

  it("the governed type constant is WAREHOUSE", () => {
    expect(RECEIVING_LOCATION_TYPE).toBe("WAREHOUSE");
    expect(__test__.RECEIVING_LOCATION_TYPE).toBe("WAREHOUSE");
  });
});

// The Customer adapter MIRRORS the merged I-LA5 backend single-segment ID predicate exactly
// (no stricter Customer identity authority). These boundary cases must agree on both sides.
describe("adaptReceivingLocationOptions -- value id: backend-predicate parity", () => {
  const CTRL = "WH" + String.fromCharCode(1) + "1"; // control char accepted by the backend
  const DEL = "WH" + String.fromCharCode(127) + "1"; // DEL accepted by the backend
  it.each([
    // [label, value, backendValid]
    ["simple", "WH-1", true],
    ["dot inside", "WH.1", true],
    ["underscores (not reserved)", "_WH_1_", true],
    ["leading whitespace (trim-nonblank)", " WH-1", true],
    ["trailing whitespace (trim-nonblank)", "WH-1 ", true],
    ["surrounding whitespace", " WH-1 ", true],
    ["internal whitespace", "WH 1", true],
    ["control char U+0001 (backend-accepted)", CTRL, true],
    ["DEL U+007F (backend-accepted)", DEL, true],
    ["max length 1500 bytes", "x".repeat(1500), true],
    ["contains slash", "a/b", false],
    ["dot", ".", false],
    ["dotdot", "..", false],
    ["reserved __x__", "__name__", false],
    ["empty", "", false],
    ["whitespace only", "   ", false],
    ["too long 1501", "x".repeat(1501), false],
  ])("id %s -> predicate and adapter agree", (_l, value, backendValid) => {
    expect(isBackendValidIdSegment(value)).toBe(backendValid);
    expect(adaptReceivingLocationOptions([{ value, label: "L", type: "WAREHOUSE" }]).ok).toBe(backendValid);
  });

  it.each([
    ["non-string number", 5],
    ["non-string null", null],
    ["non-string object", {}],
  ])("non-string value %s -> fails closed", (_l, value) => {
    expect(isBackendValidIdSegment(value)).toBe(false);
    expect(adaptReceivingLocationOptions([{ value, label: "L", type: "WAREHOUSE" }])).toEqual({ ok: false, options: [] });
  });

  it("preserves a backend-valid whitespace-bearing ID VERBATIM (value never trimmed)", () => {
    const r = adaptReceivingLocationOptions([{ value: " WH-1 ", label: "  Central  ", type: "WAREHOUSE" }]);
    expect(r.ok).toBe(true);
    expect(r.options[0].value).toBe(" WH-1 "); // whitespace preserved verbatim
    expect(r.options[0].label).toBe("Central"); // label still trimmed for display
  });
});

describe("adaptReceivingLocationOptions -- label must be a non-blank string", () => {
  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["number", 5],
    ["null", null],
    ["object", {}],
  ])("label %s -> fails closed", (_l, label) => {
    expect(adaptReceivingLocationOptions([{ value: "A", label, type: "WAREHOUSE" }])).toEqual({ ok: false, options: [] });
  });
});

describe("adaptReceivingLocationOptions -- whole-payload fail-closed", () => {
  it("a single malformed row fails the ENTIRE payload (no partial options)", () => {
    const r = adaptReceivingLocationOptions([OK("WH-1", "Valid"), { value: "WH-2", label: "", type: "WAREHOUSE" }]);
    expect(r).toEqual({ ok: false, options: [] });
  });

  it("duplicate values fail the entire payload closed", () => {
    const r = adaptReceivingLocationOptions([OK("DUP", "One"), OK("DUP", "Two")]);
    expect(r).toEqual({ ok: false, options: [] });
  });

  it("distinct values with identical labels are allowed (not duplicates)", () => {
    const r = adaptReceivingLocationOptions([OK("WH-1", "Same"), OK("WH-2", "Same")]);
    expect(r.ok).toBe(true);
    expect(r.options.map((o) => o.value)).toEqual(["WH-1", "WH-2"]);
  });
});

describe("adaptReceivingLocationOptions -- sanitized, deterministic, non-mutating", () => {
  it("output options carry exactly value/label/type -- no extra/raw keys survive", () => {
    const r = adaptReceivingLocationOptions([OK("WH-1", "Central")]);
    expect(Object.keys(r.options[0]).sort()).toEqual(["label", "type", "value"]);
  });

  it("is deterministic (identical output across calls)", () => {
    const input = [OK("b", "B"), OK("a", "A")];
    expect(adaptReceivingLocationOptions(input)).toEqual(adaptReceivingLocationOptions(input));
  });

  it("does not mutate the input array or its rows", () => {
    const rows = [Object.freeze(OK("b", "B")), Object.freeze(OK("a", "A"))];
    const input = Object.freeze([...rows]);
    const before = JSON.stringify(input);
    expect(() => adaptReceivingLocationOptions(input)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before); // input order + contents unchanged
    expect(input[0]).toBe(rows[0]); // input array not re-ordered in place
  });

  it("returns a frozen result and frozen options (immutable)", () => {
    const r = adaptReceivingLocationOptions([OK("WH-1", "Central")]);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.options)).toBe(true);
    expect(Object.isFrozen(r.options[0])).toBe(true);
  });
});
