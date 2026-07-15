import { useCallback, useEffect, useId, useRef } from "react";
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

  // Issue #293. The keydown handler needs the CURRENT onClose, but the mount effect
  // below must not re-run when onClose's identity changes -- so the callback reaches
  // the handler through a ref instead of through the dependency array.
  //
  // What went wrong before: this component had ONE effect keyed [onClose] that both
  // set up focus AND registered keydown. Callers pass a plain `function requestClose()`
  // (a new identity every render), and a modal re-renders on every keystroke as its
  // form state changes -- so the effect tore down and re-ran per character. The
  // cleanup's focus-restore fired (focus was still inside the dialog, so
  // appMovedFocusAway was false) and the re-run focused the dialog's first focusable,
  // the ✕ button. Typing a multi-word value therefore lost characters, and the first
  // SPACE activated the focused ✕ and DISCARDED THE FORM. Verified live against
  // LocationCreateModal on main: typing "Main Office" closed the modal.
  //
  // Correctness must not depend on every caller remembering useCallback -- that is a
  // trap that re-arms itself for the next modal author. Callers may pass whatever they
  // like; this component is now indifferent to onClose's identity.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  // Stable for the whole mount, so it is safe in the mount effect's closure and as an
  // event handler prop.
  const requestClose = useCallback(() => onCloseRef.current?.(), []);

  // MOUNT-ONLY effect: focus setup, scroll lock, and the keydown listener. Deps are []
  // deliberately -- everything time-varying is read through a ref.
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
        onCloseRef.current?.();
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
      // Restore focus to the trigger, UNLESS the app deliberately moved focus to
      // some element OUTSIDE this dialog (e.g. onto a newly created row on
      // success). At cleanup the focused element is still inside the closing
      // dialog (or has already fallen to <body>) -- both mean the app did not
      // steal focus, so we restore to the trigger. If focus is on an external
      // element, we leave it there.
      const restore = previouslyFocusedRef.current;
      const active = document.activeElement;
      const appMovedFocusAway = active && active !== document.body && dialog && !dialog.contains(active);
      if (restore && typeof restore.focus === "function" && !appMovedFocusAway) {
        restore.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Issue #293: MOUNT-ONLY on
    // purpose. onClose is read via onCloseRef, so adding it here would restore the very
    // per-keystroke teardown this fix removes.
  }, []);

  return createPortal(
    <div className="fo-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
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
          <button type="button" className="fo-modal-close" aria-label={closeLabel} onClick={requestClose}>
            &times;
          </button>
        </div>
        <div className="fo-modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
