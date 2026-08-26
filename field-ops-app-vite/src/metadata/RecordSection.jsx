import { useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import Icon from "../shared/ui/Icon.jsx";
import { SectionHeader } from "../shared/ui/primitives/index.js";

// A COLLAPSIBLE RECORD SECTION — one implementation, every object.
//
// ════════════════════ WHY COLLAPSE AT ALL ════════════════════
//
// A record page that renders every declared field at once is a wall. Density (pageDefinition.js's
// SECTION_DENSITY) is how a definition says which facts answer "what is this and what state is it
// in" and which are reference material, and this is where that decision becomes pixels.
//
// COLLAPSED IS NOT HIDDEN, and the distinction is the whole design:
//
//   · every section renders, with its heading visible, whether open or closed
//   · the control is a real <button> — reachable by Tab, operated by Enter and Space, because it
//     is a button and not a div with a click handler
//   · aria-expanded says which state it is in, so a screen reader announces "collapsed" rather
//     than the section simply not being read out
//   · the content is unmounted while closed rather than visually hidden, so a closed section
//     cannot leave focusable controls in the tab order pointing at something nobody can see
//
// Collapsing changes what is on screen. It changes no data and no authority — a field a person may
// not edit is equally uneditable open or closed.
//
// ════════════════════ NO NESTED ACCORDIONS ════════════════════
//
// One level. A section either collapses or it does not; a collapsible section inside a collapsible
// section means two clicks to reach a fact and no reliable way to tell which one is hiding it.

export default function RecordSection({
  section,
  label,
  // Used ONLY to name a collapsible toggle whose section declared no label -- a control must
  // have an accessible name. It is deliberately NOT a heading fallback: see MetadataRecordPage.
  fallbackLabel = null,
  collapsible = false,
  defaultCollapsed = false,
  className = "",
  children,
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const contentId = useId();

  const accessibleName = label ?? fallbackLabel ?? section?.id ?? "Section";

  if (!collapsible) {
    return (
      <section className={className} data-section-id={section?.id ?? undefined} aria-label={accessibleName}>
        {label && <SectionHeader title={label} level={3} className="fo-record-section-title" />}
        {children}
      </section>
    );
  }

  return (
    <section className={className} data-section-id={section?.id ?? undefined} aria-label={accessibleName}>
      <h3 className="fo-record-section-title fo-record-section-title--toggle">
        {/* The heading CONTAINS the button rather than sitting beside it, so the accessible name of
            the control is the section name — "Notes & Identifiers, collapsed" — instead of a page
            full of controls all called "Toggle". */}
        <button
          type="button"
          className="fo-record-section__toggle"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon icon={open ? ChevronDown : ChevronRight} size="dense" aria-hidden="true" />
          <span>{accessibleName}</span>
        </button>
      </h3>
      {/* Unmounted while closed, not display:none — a hidden-but-present subtree keeps its
          controls in the tab order, so Tab would land focus on something invisible. */}
      {open && <div id={contentId}>{children}</div>}
    </section>
  );
}
