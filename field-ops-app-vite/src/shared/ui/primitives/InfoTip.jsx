import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import Icon from "../Icon.jsx";

// Compact UX Standard (docs/design/compact-ux-standard.md §4) -- the ONE place secondary
// explanation goes once it leaves the page body. An info button whose text is the
// accessible description of the button itself, so a screen reader hears it on focus
// whether or not the bubble is showing.
//
// Opens on: mouse hover, keyboard focus, and tap/click (touch has no hover, so a tap
// pins it open; a second tap or a tap anywhere else closes it). Escape closes it
// without moving focus. Never put a warning, error, refusal, approval or required
// instruction in here -- those stay visible on the page (standard §6).
//
// The bubble is position:fixed and placed from the trigger's rect, because most
// triggers sit inside a .fo-panel, whose overflow-x:auto would otherwise clip an
// absolutely positioned bubble or give the panel a scrollbar.
export default function InfoTip({ label, children, className = "" }) {
  const tipId = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const bubbleRef = useRef(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pos, setPos] = useState(null);
  const open = !dismissed && (hover || focus || pinned);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !bubbleRef.current) return undefined;
    const place = () => {
      const r = triggerRef.current.getBoundingClientRect();
      const w = bubbleRef.current.offsetWidth;
      const h = bubbleRef.current.offsetHeight;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const below = r.bottom + 6 + h <= window.innerHeight;
      setPos({ left, top: below ? r.bottom + 6 : Math.max(8, r.top - h - 6) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!pinned) return undefined;
    const outside = (e) => {
      if (!rootRef.current?.contains(e.target)) setPinned(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [pinned]);

  return (
    <span
      ref={rootRef}
      className={["fo-infotip", className].filter(Boolean).join(" ")}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        setHover(false);
        setDismissed(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="fo-infotip__trigger"
        aria-label={label}
        aria-describedby={tipId}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          setPinned(false);
          setDismissed(false);
        }}
        onClick={() => {
          setDismissed(false);
          setPinned((p) => !p);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setPinned(false);
            setDismissed(true);
          }
        }}
      >
        <Icon icon={Info} size="dense" />
      </button>
      <span
        ref={bubbleRef}
        role="tooltip"
        id={tipId}
        className="fo-infotip__bubble"
        hidden={!open}
        style={pos ? { left: pos.left, top: pos.top } : undefined}
      >
        {children}
      </span>
    </span>
  );
}
