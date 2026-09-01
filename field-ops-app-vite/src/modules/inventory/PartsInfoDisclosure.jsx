import { useEffect, useId, useRef, useState } from "react";

// THE (i) FROM THE P1v2 FRAMES — progressive disclosure for governance detail.
//
// Owner ruling B, 2026-08-31. Frames 1a and 1b draw a circled `i` in three product places: beside
// Request reorder, at the end of the Purchasing context line, and beside the catalogue count. It is
// not decoration — it is Design's answer to the finding that started this whole redesign, that
// "stating an absence costs more than stating what is known". The concise sentence stays on the
// page; the long governed explanation moves behind the control and stays reachable.
//
// NOTHING IS DELETED. That is the difference between this and a cut, and it is why the Owner chose
// it over removing content: every word that was rendered inline is still here, still in the DOM
// when opened, still available to assistive technology.
//
// ════════════════════ WHY THIS IS NOT A TOOLTIP ════════════════════
//
// The Owner ruled the interaction explicitly, and the reason is the content: this is substantive
// governance text, not a hint. A hover-only tooltip is unreachable on touch, unreachable by
// keyboard, and frequently unreachable by screen reader — which would mean the explanation had been
// removed for exactly the operators most likely to be standing in a warehouse holding a phone.
//
// So it is a real <button> with a real disclosure:
//   - Enter/Space open it, because it is a button and not a span with an onClick
//   - pointer and touch open it, for the same reason
//   - Escape closes it and returns focus to the trigger
//   - a click anywhere outside closes it
//   - aria-expanded says whether it is open; aria-controls ties it to the panel it opens
//   - the accessible name says WHAT is being explained, not "more info"
//
// ════════════════════ WHY THE PANEL IS ALWAYS RENDERED ════════════════════
//
// It is rendered with `hidden` rather than conditionally mounted, for two reasons. `aria-controls`
// must point at an element that exists, or the relationship it declares is a lie. And a hidden
// element contributes NO layout height — which is the other half of the ruling: a closed disclosure
// must cost the page nothing, or it would trade one kind of permanent height for another.
//
// ════════════════════ WHY THE PANEL IS ALL INLINE ELEMENTS ════════════════════
//
// Two of the three call sites sit inside a <p>. A <div> there is invalid HTML, and invalid HTML is
// how a layout works everywhere except the one browser that reparses it. Spans, styled as blocks.
//
// PARTS-LOCAL ON PURPOSE. No shared North Star information-disclosure primitive exists today —
// LifecycleBand has aria-expanded but no popover, no Escape and no popup semantics — and the Owner
// was explicit that Parts must not become the vehicle for a design-system migration. If a second
// family needs this, that is the moment to promote it, with that family's composition in hand.
export default function PartsInfoDisclosure({ label, children, align = "start" }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = `${useId()}-info`;

  function close({ refocus = false } = {}) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close({ refocus: true });
      }
    }
    // `mousedown`, not `click`: a click that begins inside the panel and ends outside it (selecting
    // the text, which is a thing people do with an explanation) must not be read as dismissal.
    function onPointerDown(e) {
      if (panelRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      close();
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <span className="ns-info">
      <button
        ref={triggerRef}
        type="button"
        className="ns-info__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        // THE NAME SAYS WHAT IT EXPLAINS. "More information" tells a screen-reader user that there
        // are three identical controls on this page and nothing about which one they want.
        aria-label={open ? `Hide: ${label}` : `Explain: ${label}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span aria-hidden="true">i</span>
      </button>
      <span
        ref={panelRef}
        id={panelId}
        role="note"
        hidden={!open}
        className={`ns-info__panel ns-info__panel--${align}`}
      >
        <span className="ns-info__body">{children}</span>
        <button type="button" className="ns-info__close" onClick={() => close({ refocus: true })}>
          Close
        </button>
      </span>
    </span>
  );
}
