// Finance — allocation & consolidation core (F10 / FIN-009). Pure tests. Proves: exact integer
// allocation (parts always sum to the whole; deterministic largest-remainder; credits allocate
// symmetrically), and honest consolidation (per-company totals; the consolidated figure is an
// UNELIMINATED_SUM by type — no invented elimination; company-less facts refuse).
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateAmountExactly, summarizeByCompany, AllocationError } from "../lib/finance/financialAllocation.js";

test("proportional split sums EXACTLY to the whole (no rounding leak)", () => {
  const r = allocateAmountExactly(100, [{ ref: "A", weight: 1 }, { ref: "B", weight: 1 }, { ref: "C", weight: 1 }]);
  assert.equal(r.reduce((n, l) => n + l.amountMinor, 0), 100);
  assert.deepEqual(r.map((l) => l.amountMinor).sort((a, b) => a - b), [33, 33, 34]);
});

test("largest-remainder is deterministic: equal fractions resolve by input order", () => {
  const a = allocateAmountExactly(101, [{ ref: "X", weight: 1 }, { ref: "Y", weight: 1 }]);
  assert.deepEqual(a, [{ ref: "X", amountMinor: 51 }, { ref: "Y", amountMinor: 50 }]);
  // repeated call — identical result
  assert.deepEqual(allocateAmountExactly(101, [{ ref: "X", weight: 1 }, { ref: "Y", weight: 1 }]), a);
});

test("weighted split follows weights; exactness holds under awkward weights", () => {
  const r = allocateAmountExactly(1000, [{ ref: "A", weight: 3 }, { ref: "B", weight: 3 }, { ref: "C", weight: 1 }]);
  assert.equal(r.reduce((n, l) => n + l.amountMinor, 0), 1000);
  assert.ok(r.find((l) => l.ref === "C").amountMinor < r.find((l) => l.ref === "A").amountMinor);
});

test("a negative amount (credit) allocates symmetrically and still sums exactly", () => {
  const r = allocateAmountExactly(-100, [{ ref: "A", weight: 2 }, { ref: "B", weight: 1 }]);
  assert.equal(r.reduce((n, l) => n + l.amountMinor, 0), -100);
  assert.deepEqual(r, [{ ref: "A", amountMinor: -67 }, { ref: "B", amountMinor: -33 }]);
});

test("zero targets / non-positive weights / non-integer amounts refuse", () => {
  assert.throws(() => allocateAmountExactly(100, []), (e) => e instanceof AllocationError && e.code === "TARGETS_REQUIRED");
  assert.throws(() => allocateAmountExactly(100, [{ ref: "A", weight: 0 }]), (e) => e.code === "TARGET_INVALID");
  assert.throws(() => allocateAmountExactly(100, [{ ref: "A", weight: -1 }]), (e) => e.code === "TARGET_INVALID");
  assert.throws(() => allocateAmountExactly(100.5, [{ ref: "A", weight: 1 }]), (e) => e.code === "AMOUNT_INVALID");
});

test("per-company rollup totals each company that appears; output ordered by company id", () => {
  const r = summarizeByCompany([
    { ref: "1", operatingCompanyId: "taylor", amountMinor: 100 },
    { ref: "2", operatingCompanyId: "ventana", amountMinor: 50 },
    { ref: "3", operatingCompanyId: "taylor", amountMinor: 25 },
  ]);
  assert.deepEqual(r.byCompany, [
    { operatingCompanyId: "taylor", totalMinor: 125, factCount: 2 },
    { operatingCompanyId: "ventana", totalMinor: 50, factCount: 1 },
  ]);
});

test("the consolidated figure is an UNELIMINATED_SUM by type — never presented as eliminated", () => {
  const r = summarizeByCompany([
    { ref: "1", operatingCompanyId: "taylor", amountMinor: 100 },
    { ref: "2", operatingCompanyId: "ventana", amountMinor: 50 },
  ]);
  assert.deepEqual(r.consolidated, { status: "UNELIMINATED_SUM", totalMinor: 150 });
});

test("a company-less fact refuses the whole rollup — no reportable number without its company", () => {
  assert.throws(
    () => summarizeByCompany([{ ref: "1", operatingCompanyId: "", amountMinor: 100 }]),
    (e) => e.code === "COMPANY_REQUIRED",
  );
  assert.throws(() => summarizeByCompany([{ ref: "1", operatingCompanyId: "taylor", amountMinor: 1.5 }]), (e) => e.code === "FACT_INVALID");
});

test("empty fact set is a legitimate zero rollup", () => {
  const r = summarizeByCompany([]);
  assert.deepEqual(r.byCompany, []);
  assert.equal(r.consolidated.totalMinor, 0);
});
