import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

// Shared modal overlay -- the REFERENCE creation-overlay pattern (Customer
// Creation Overlay). Renders into a portal on document.body so it escapes the
// page's stacking/overflow context; the page underneath does not move or
// re-layout when it opens.
//
// Accessibility / behavior contract (verified by the driver's
// verify-customer-create-overlay):
//   - role="dialog" aria-modal="true", labelled by a visible <h2> title.
//   - Initial focus moves into the dialog on open; focus is TRAPPED (Tab /
//     Shift+Tab cycle within the dialog, never escaping to the page behind).
//   - Escape, the Cancel/close control, and a backdrop click all call onClose.
//   - Background interaction is blocked: a full-viewport backdrop intercepts
//     pointer events and the focus trap keeps keyboard focus inside.
//   - On close, focus is restored to whatever was focused when it opened
//     (the "New Customer" trigger) -- unless the caller has already moved
//     focus elsewhere (e.g. onto the newly created row).
//   - Body scroll is locked while open.
//
// Deliberately generic: it knows nothing about Accounts. Other creation flows
// are NOT migrated in this PR (this is the reference only).
function focusable(container) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export default function Modal({ title, onClose, children, closeLabel = "Cancel" }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  // Captured once, at mount, so we can restore focus to the trigger on close.
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    const dialog = dialogRef.current;

    // Initial focus: first focusable inside the dialog, else the dialog itself.
    const first = focusable(dialog)[0];
    (first ?? dialog)?.focus();

    // Lock body scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable(dialog);
      if (items.length === 0) {
        e.preventDefault();
        dialog?.focus();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstEl || active === dialog)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      } else if (!dialog.contains(active)) {
        // Focus somehow left the dialog -- pull it back in.
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // Restore focus to the trigger, unless the app moved focus elsewhere
      // (e.g. onto the newly created customer's name) while we were open.
      const restore = previouslyFocusedRef.current;
      if (restore && typeof restore.focus === "function" && document.activeElement === document.body) {
        restore.focus();
      }
    };
  }, [onClose]);

  return createPortal(
    <div className="fo-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="fo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="fo-modal-header">
          <h2 id={titleId} className="fo-modal-title">{title}</h2>
          <button type="button" className="fo-modal-close" aria-label={closeLabel} onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="fo-modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
