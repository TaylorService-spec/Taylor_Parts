import { FIELD_KIND, fieldsForWidth } from "../../domain/structuredFields.js";

// FIELDS, RENDERED. One component, because there must be exactly one place that decides how a
// business attribute reaches a screen.
//
// ============================ WHY A DEFINITION LIST ============================
//
// `<dl>` is the element for label/value pairs, and it is what makes each attribute independently
// addressable to a screen reader, a stylesheet and a test. A `<table>` would work on a desktop and
// is unusable at 320px; a `<p>` of concatenated text would be neither.
//
// The responsive behaviour is the point of the priority system: a narrow screen DROPS low-priority
// fields. It never merges two fields into one line of prose, because that is the one transformation
// no downstream consumer can undo.
//
// ============================ ABSENCE IS RENDERED, NOT HIDDEN ============================
//
// A field with no value still renders, carrying which KIND of absence it is: not recorded, not
// available to you, or unresolved. Omitting the row entirely would make "we have no serial for this"
// indistinguishable from "this object has no serial concept at all".

/**
 * The status modifier class.
 *
 * Computed here rather than inline in the JSX: an expression inside a className template defeats
 * static class extraction, and this project's stylesheet-coverage guard reads those statically. A
 * helper keeps the guard able to see `fo-fields__status` while the per-status modifier stays
 * dynamic — modifiers are optional styling hooks, and an unstyled one changes nothing, because the
 * word is what carries the meaning.
 */
const statusClass = (raw) =>
  `fo-fields__status fo-fields__status--${String(raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/**
 * @param fields       from domain/structuredFields.js.
 * @param maxPriority  1 = only essentials, 3 = everything. Chosen by the surface, not by this file.
 * @param label        accessible name for the group.
 */
export default function StructuredFields({ fields, maxPriority = 3, label = "Details", className = "" }) {
  const shown = fieldsForWidth(fields, maxPriority);
  if (shown.length === 0) return null;

  return (
    <dl className={`fo-fields ${className}`.trim()} aria-label={label}>
      {shown.map((f) => (
        <div className="fo-fields__row" key={f.label}>
          <dt className="fo-fields__label">{f.label}</dt>
          <dd
            className={`fo-fields__value${f.present ? "" : " fo-fields__value--absent"}`}
            // The domain value, kept on the element so a filter, a sort or a test reaches the enum
            // rather than the human wording. `IN_TRANSIT` lives here; "In Transit" is what is read.
            data-kind={f.kind}
            data-raw={f.raw === null || f.raw === undefined ? undefined : String(f.raw)}
          >
            {f.kind === FIELD_KIND.STATUS && f.present ? (
              // Status carries a class so it MAY be styled, and its WORD regardless — colour is
              // never the only signal, on a phone in sunlight or in a greyscale screenshot.
              <span className={statusClass(f.raw)}>{f.value}</span>
            ) : (
              f.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
