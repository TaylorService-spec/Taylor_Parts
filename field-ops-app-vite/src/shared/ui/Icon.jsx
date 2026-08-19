// Design-system foundation (PR 1) -- the ONE icon system for this app. lucide-react
// supplies the glyph set; this wrapper is the only place that touches size/stroke,
// so no consumer can drift to an ad-hoc pixel size or stroke weight. There is no
// emoji fallback path -- operational UI never uses emoji for status or action
// meaning (Owner constraint), and this wrapper is how that stays enforced rather
// than merely documented.
//
// Sizing scale (fixed, not freeform -- pass `size`, never a raw number):
//   dense   16px  inline with text / dense table rows
//   button  18px  inside buttons and form controls (the DEFAULT)
//   nav     20px  navigation / rail items
//   action  24px  major/standalone actions
//   empty   32px  empty-state illustrations (the max -- never larger)
const SIZE_TOKENS = {
  dense: "var(--icon-size-dense)",
  button: "var(--icon-size-button)",
  nav: "var(--icon-size-nav)",
  action: "var(--icon-size-action)",
  empty: "var(--icon-size-empty)",
};

// Default stroke sits inside the 1.75-2px band the program specifies; a caller may
// widen it (e.g. to 2 for a lone large empty-state glyph) but never thinner --
// thinner strokes disappear on the low-contrast field devices this app targets.
const DEFAULT_STROKE_WIDTH = 1.75;

export default function Icon({
  icon: LucideIcon,
  size = "button",
  strokeWidth = DEFAULT_STROKE_WIDTH,
  decorative = true,
  label,
  className = "",
  ...rest
}) {
  if (!LucideIcon) return null;
  const px = SIZE_TOKENS[size] ?? SIZE_TOKENS.button;
  // Icons are decorative by default (paired with visible text elsewhere in the
  // control) and hidden from assistive tech. Pass `decorative={false}` + `label`
  // for the rare icon-only case that isn't already covered by IconButton's own
  // required aria-label.
  const a11yProps = decorative
    ? { "aria-hidden": true, focusable: "false" }
    : { role: "img", "aria-label": label };
  return (
    <LucideIcon
      className={["fo-icon", className].filter(Boolean).join(" ")}
      width={px}
      height={px}
      strokeWidth={strokeWidth}
      {...a11yProps}
      {...rest}
    />
  );
}
