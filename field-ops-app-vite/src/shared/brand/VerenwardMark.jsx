/**
 * VerenwardMark — the single Verenward brand component.
 *
 * PROVISIONAL ASSET. This is a deliberately restrained inline SVG standing in
 * for the final approved logo, which the Owner reviews separately. It is
 * isolated here precisely so that replacement is a one-file change rather than
 * a page-by-page edit: nothing else in the app hand-codes brand markup.
 *
 * Direction (per the approved brand foundation):
 *   V             = Verenward, and an upward/living structure
 *   partial ring  = guardianship, continuity, protection
 *   guiding star  = guidance, wisdom
 * Explicitly NOT: a literal tree, a shield, a character, or AI/robot imagery.
 *
 * Brand hierarchy this component expresses:
 *   Verenward                — provisional parent brand
 *   Enterprise Operations OS — the platform
 * The IMPLEMENTATION (e.g. Taylor Parts) is identified separately by the caller
 * and is never replaced by brand naming.
 *
 * Variants:
 *   icon      — mark only (favicons, tight chrome, mobile headers)
 *   compact   — mark + "VERENWARD" (narrow sidebars)
 *   horizontal— mark + full two-line lockup (primary app shell)
 *
 * Tone: `onDark` (default) for evergreen/guardian surfaces, `onLight` for stone
 * surfaces. Colors come from brand tokens so a palette revision flows through.
 */
function MarkGlyph({ size, title, titleId, descId }) {
  return (
    <svg
      className="fo-brand__glyph"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      focusable="false"
    >
      <title id={titleId}>{title}</title>
      <desc id={descId}>
        A stylised letter V inside a partial guardian ring, with a guiding star above.
      </desc>

      {/* Partial guardian ring — open at the top so the star reads as guiding
          the system rather than being enclosed by it. Stroked, never filled. */}
      <path
        d="M12.5 9.5a19 19 0 1 0 23 0"
        fill="none"
        stroke="var(--fo-brand-ring)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* The living V — a single open stroke, weighted to feel structural
          rather than decorative. */}
      <path
        d="M16 19.5 24 34.5 32 19.5"
        fill="none"
        stroke="var(--fo-brand-v)"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Guiding star — a small four-point form, kept simple so it does not
          compete with the V at small sizes. */}
      <path
        d="M24 4.25 25.5 8.5 29.75 10 25.5 11.5 24 15.75 22.5 11.5 18.25 10 22.5 8.5Z"
        fill="var(--fo-brand-star)"
      />
    </svg>
  );
}


export default function VerenwardMark({
  variant = "horizontal",
  tone = "onDark",
  size = 34,
  platform = "Enterprise Operations OS",
  className = "",
}) {
  // Stable-enough ids for aria-labelledby without pulling in a dependency;
  // multiple marks on one page each get their own.
  const uid = `fo-brand-${variant}-${tone}`;
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const title = platform ? `Verenward — ${platform}` : "Verenward";

  const classes = ["fo-brand", `fo-brand--${variant}`, `fo-brand--${tone}`, className]
    .filter(Boolean)
    .join(" ");

  if (variant === "icon") {
    return (
      <span className={classes}>
        <MarkGlyph size={size} title={title} titleId={titleId} descId={descId} />
      </span>
    );
  }

  return (
    <span className={classes}>
      <MarkGlyph size={size} title={title} titleId={titleId} descId={descId} />
      <span className="fo-brand__lockup">
        <span className="fo-brand__wordmark">VERENWARD</span>
        {variant === "horizontal" && platform ? (
          <span className="fo-brand__platform">{platform}</span>
        ) : null}
      </span>
    </span>
  );
}

