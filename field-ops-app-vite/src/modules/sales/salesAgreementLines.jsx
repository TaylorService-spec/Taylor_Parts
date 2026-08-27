import { Button } from "../../shared/ui/primitives/index.js";
import ProductReferencePicker from "./ProductReferencePicker.jsx";

// SALES AGREEMENT LINE PRICING — extracted from SalesAgreementPanel.jsx, unchanged.
//
// ════════════════════ WHY THIS FILE EXISTS (SA-G7) ════════════════════
//
// These were private to SalesAgreementPanel.jsx, which was correct while the workspace pane was the
// only place an agreement could be priced. The Sales Agreement record page (family 5) took over
// read, acceptance and terms editing — but NOT line pricing, so the pane remained the sole surface
// for it, and retiring the pane would have deleted an activated governed capability. That gap is
// SA-G7, and it is what blocks Opportunity Workspace P1v3 and ND-13.
//
// Two surfaces pricing the same agreement through two editors is how one of them comes to round
// differently, or to accept a price shape the other rejects. `toMinor` in particular is the whole
// currency contract in eight lines: empty means UNPRICED and not zero, and anything that is not a
// plain amount is REFUSED rather than coerced. A second copy of that is a second answer to "what
// did the customer agree to pay".
//
// So the subtree MOVED here and both surfaces import it. Nothing was rewritten in the move:
// `salesAgreementPanel` tests exercise it exactly as before, and the record page now composes the
// same editor over the same governed `updateSalesAgreementDraft` command.
//
// NO NEW AUTHORITY. This file builds a command payload; it does not decide who may send it, when it
// is legal, or what the server will accept. DRAFT-only remains `agreementIsEditable`, the capability
// remains `salesAgreement.updateDraft`, and the server re-validates everything either way.

const BLANK_LINE = { kind: "PART", ref: "", quantity: "1", unitPrice: "" };

/** Major-unit text -> integer minor units. Empty stays UNDEFINED, which is "no price yet", not zero. */
function toMinor(text) {
  const t = String(text ?? "").trim();
  if (t === "") return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN; // rejected by the caller; never silently coerced
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/**
 * Integer minor units -> the editor's major-unit text. The exact inverse of `toMinor`, and the
 * round trip matters: seeding an editor is how a value that was never touched gets written back.
 *
 * NULL STAYS EMPTY. An unpriced line seeded as "0.00" would be submitted as a price of zero the
 * moment anybody saved an unrelated field on that agreement -- silently turning "we have not
 * priced this yet" into "this is free". Empty is the only correct seed for absent.
 */
function toMajorText(minor) {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return "";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** A stored line -> the editor's row shape. Used when opening the editor on an existing draft. */
function toEditorLines(viewLines) {
  const rows = (Array.isArray(viewLines) ? viewLines : []).map((l) => ({
    kind: l.kind ?? "PART",
    ref: l.ref ?? "",
    quantity: l.quantity == null ? "1" : String(l.quantity),
    unitPrice: toMajorText(l.unitPriceMinor),
  }));
  // An agreement with no lines still needs one editable row to be useful.
  return rows.length > 0 ? rows : [{ ...BLANK_LINE }];
}

function LinesEditor({ lines, onChange, disabled }) {
  const set = (i, patch) => onChange(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  return (
    <div className="fo-agreement-lines">
      {lines.map((l, i) => (
        <div key={i} className="fo-agreement-line">
          {/* CHANGING THE KIND CLEARS THE REF, and that is the correct destructive default.
              A ref belongs to exactly one catalog: a part id carried over into an EQUIPMENT_MODEL
              line is not a value worth preserving, it is the wrong-kind error waiting to happen at
              submit. Clearing says so immediately, at the moment the user made the choice. */}
          <select aria-label={`Line ${i + 1} kind`} value={l.kind} disabled={disabled}
            onChange={(e) => set(i, { kind: e.target.value, ref: "" })}>
            <option value="EQUIPMENT_MODEL">Equipment model</option>
            <option value="PART">Part</option>
            <option value="SERVICE">Service</option>
          </select>
          <ProductReferencePicker
            kind={l.kind}
            value={l.ref}
            lineNumber={i + 1}
            disabled={disabled}
            onChange={(ref) => set(i, { ref })}
          />
          <input aria-label={`Line ${i + 1} quantity`} inputMode="numeric" value={l.quantity} disabled={disabled}
            onChange={(e) => set(i, { quantity: e.target.value })} />
          {/* Left empty this is an UNPRICED line, which a draft is allowed to carry. It becomes the
              thing that blocks acceptance, and the Accept control says so by name. */}
          <input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" placeholder="Price" value={l.unitPrice}
            disabled={disabled} onChange={(e) => set(i, { unitPrice: e.target.value })} />
          {lines.length > 1 && (
            <Button variant="ghost" disabled={disabled} onClick={() => onChange(lines.filter((_, n) => n !== i))}>
              Remove
            </Button>
          )}
        </div>
      ))}
      <Button variant="ghost" disabled={disabled} onClick={() => onChange([...lines, { ...BLANK_LINE }])}>
        Add line
      </Button>
    </div>
  );
}

/** Turns the editor's text into the command's shape, or returns the reason it cannot. */
function buildLines(draftLines) {
  const out = [];
  for (const [i, l] of draftLines.entries()) {
    const ref = String(l.ref ?? "").trim();
    if (!ref) return { error: `Line ${i + 1} needs an item.` };
    const quantity = Number(l.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return { error: `Line ${i + 1} needs a whole quantity above zero.` };
    const unitPrice = toMinor(l.unitPrice);
    if (Number.isNaN(unitPrice)) return { error: `Line ${i + 1}'s price must be an amount like 1250.00.` };
    // `unitPrice: undefined` is omitted by the transport, so an unpriced draft line stays unpriced
    // rather than arriving as a zero the server would read as "free".
    out.push(unitPrice === undefined ? { kind: l.kind, ref, quantity } : { kind: l.kind, ref, quantity, unitPrice });
  }
  return { lines: out };
}

export { BLANK_LINE, toMinor, toMajorText, toEditorLines, LinesEditor, buildLines };
