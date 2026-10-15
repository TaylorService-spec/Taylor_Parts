"use strict";
// Finance — PURE gross-margin derivation core (F5 / FIN-006). FIN-001's central cost finding:
// GROSS_MARGIN_AUTHORITY = MISSING — a governed revenue side exists (dormant SO/invoice prices) but NO
// governed cost side exists anywhere (no receipt cost, no costing method, no labor rates; the supplier
// quote `part_supplier_items.cost` is a term, not a cost event). This module therefore encodes the ONE
// invariant every future margin consumer must obey, without deciding costing policy:
//
//   MARGIN IS COMPUTED ONLY FROM GOVERNED COST FACTS. A revenue line with no matched governed cost fact
//   makes the margin UNKNOWN — never "revenue − 0", never a supplier quote borrowed as cost, never a
//   partial margin silently presented as the whole. Mirrors the equipment-availability UNKNOWN-fail-closed
//   precedent: absence of evidence is surfaced, not defaulted.
//
// What a "governed cost fact" IS (which basis is admissible, where it is captured, how labor is rated) is
// the undecided FIN-BLOCK-003 Owner decision — this core only enforces that whatever is decided must
// arrive as an explicit fact naming its governed source. Integer minor units; pure; no I/O.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostMarginError = exports.MARGIN_STATUSES = void 0;
exports.deriveGrossMargin = deriveGrossMargin;
exports.MARGIN_STATUSES = Object.freeze(["COMPUTED", "UNKNOWN"]);
class CostMarginError extends Error {
    code;
    constructor(code, message) { super(message); this.name = "CostMarginError"; this.code = code; }
}
exports.CostMarginError = CostMarginError;
const isInt = (v) => typeof v === "number" && Number.isSafeInteger(v);
// Derive gross margin for a set of revenue lines against explicit governed cost facts. COMPUTED only when
// EVERY line carries at least one governed cost fact; otherwise UNKNOWN with per-line reasons — the revenue
// total is still reported (it is governed), the margin is not.
function deriveGrossMargin(input) {
    if (typeof input?.currency !== "string" || input.currency.trim().length === 0) {
        throw new CostMarginError("CURRENCY_REQUIRED", "currency is explicit on every financial derivation");
    }
    const lines = Array.isArray(input.lines) ? input.lines : [];
    const facts = Array.isArray(input.costFacts) ? input.costFacts : [];
    // Every cost fact must be fully governed BEFORE any math — a malformed fact is a caller defect, not an
    // UNKNOWN (silently dropping it would turn a defect into a smaller margin).
    for (const f of facts) {
        for (const [field, v] of [["lineRef", f?.lineRef], ["costBasis", f?.costBasis], ["sourceType", f?.sourceType], ["sourceRecordId", f?.sourceRecordId]]) {
            if (typeof v !== "string" || v.trim().length === 0) {
                throw new CostMarginError("COST_FACT_INVALID", `cost fact ${field} is required — a cost with no governed source is not a cost fact`);
            }
        }
        if (!isInt(f.costMinor) || f.costMinor < 0) {
            throw new CostMarginError("COST_FACT_INVALID", `cost fact for line ${f.lineRef}: costMinor must be a non-negative integer (minor units)`);
        }
    }
    let revenueMinor = 0;
    for (const l of lines) {
        if (typeof l?.ref !== "string" || l.ref.trim().length === 0)
            throw new CostMarginError("LINE_INVALID", "every revenue line requires a ref");
        if (!isInt(l.revenueMinor) || l.revenueMinor < 0)
            throw new CostMarginError("LINE_INVALID", `line ${l.ref}: revenueMinor must be a non-negative integer (minor units)`);
        revenueMinor += l.revenueMinor;
    }
    const reasons = [];
    let costMinor = 0;
    for (const l of lines) {
        const lineFacts = facts.filter((f) => f.lineRef === l.ref);
        if (lineFacts.length === 0) {
            reasons.push(`Line ${l.ref}: no governed cost fact — margin cannot be computed (never revenue − 0)`);
            continue;
        }
        costMinor += lineFacts.reduce((n, f) => n + f.costMinor, 0);
    }
    const orphans = facts.filter((f) => !lines.some((l) => l.ref === f.lineRef));
    if (orphans.length > 0) {
        // A cost fact pointing at no revenue line is an attribution defect — surfaced, and the margin is not
        // presented as computed over a set the facts do not actually describe.
        reasons.push(`${orphans.length} cost fact(s) reference no revenue line (${orphans.map((f) => f.lineRef).join(", ")})`);
    }
    if (lines.length === 0)
        reasons.push("No revenue lines");
    if (reasons.length > 0) {
        return { status: "UNKNOWN", currency: input.currency, revenueMinor, costMinor: null, marginMinor: null, reasons };
    }
    return {
        status: "COMPUTED",
        currency: input.currency,
        revenueMinor,
        costMinor,
        marginMinor: revenueMinor - costMinor,
        reasons: [],
    };
}
//# sourceMappingURL=costMargin.js.map