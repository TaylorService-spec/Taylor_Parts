# EOS Visual System — the canonical North Star presentation standard

Status: **DESIGN AUTHORITY**, Owner-accepted 2026-09-02.
Supersedes the colour section of [`eos-north-star-design-grammar.md`](../design/eos-north-star-design-grammar.md) §2 for all work from this date forward.
Enforced by `field-ops-app-vite/test/visualSystem.test.mjs` (CI: `.github/workflows/visual-system-tests.yml`).

## What this document is

The one place a North Star design — existing or future — gets its colours, its text tiers and its
boundaries. It exists because the alternative has a name and a shape: every page picking its own
near-white and its own grey, each choice defensible on its own, the system gone within a quarter.

**A new design starts here. It does not start with a palette copied out of the last page.**

## How this became the standard

The Financials family piloted it (PR #1724, 2026-09-02): a true-white canvas, real contrast, visible
boundaries, and one semantic step up for the operational text tiers that were hardest to read. The
Owner accepted the result as the presentation standard for the whole authenticated application, and
the rollout promoted it — colours into `:root`, the type step onto the shared primitives, the
Financials-only shell seam deleted.

**Historical records are not rewritten.** Acceptance records, composition maps and design-grammar
extractions that cite the earlier warm palette are accurate accounts of what those artifacts used at
the time, and they stay as written. This document is the dated amendment; it governs forward work.

## The schema

These are semantic tokens declared once in `field-ops-app-vite/src/index.css` under `:root`.
**Reference the token. Never restate the hex in a page, a component or a design file.**

```css
--color-surface-page:     #FFFFFF;
--color-surface-card:     #FFFFFF;
--color-surface-elevated: #FFFFFF;
--color-surface-sunken:   #F2F5F3;

--color-text-primary:     #111111;
--color-text-secondary:   #3F4542;
--color-text-muted:       #626A66;

--color-brand-secondary:  #005A3C;
--color-focus:            #005A3C;

--color-border:           #87938D;
--color-border-strong:    #5F6C66;
```

Measured against the surface each is actually painted on:

| Token | On white | Meets |
| --- | --- | --- |
| `--color-text-primary` | 18.88:1 | AA, AAA |
| `--color-text-secondary` | 9.81:1 | AA, AAA |
| `--color-text-muted` | 5.57:1 | AA |
| `--color-brand-secondary` | 8.31:1 | AA, AAA (and 8.31:1 for white on it) |
| `--color-border` | 3.19:1 | 1.4.11 non-text |
| `--color-border-strong` | 5.49:1 | 1.4.11 non-text |

### Brand identity is unchanged

The six Verenward ramp colours (`--verenward-evergreen`, `-guardian`, `-living`, `-bronze`,
`-stone`, `-moon`) are untouched. This was a presentation migration, not a rebrand. What moved were
DERIVED steps: the page/card/sunken surfaces and the two hairlines.

Branded chrome — the rail, the masthead, inverse surfaces — stays on `--color-brand-primary`
(evergreen `#102B24`). `--color-brand-secondary` is an **emphasis** colour: primary actions, links,
selected states, focus, and primary KPI values. Do not repaint chrome with it.

## Typography

Semantic tiers, declared once on the shared primitives. These are the tiers, not a licence for a
blanket font-size increase — the display scale (`--font-size-display-sm/md/lg`) is unchanged and the
test asserts it.

| Tier | Size | Where |
| --- | --- | --- |
| States and important operational copy | 16px | `.ns-state`, workspace body |
| Tables, controls, primary working text | 15px | `.ns-table td`, `.ns-view`, `.fo-filter-btn` |
| Helper and supporting text | 14px | notes, descriptions, results |
| Compact counts and attributes | 13px | `.ns-view__count`, attribute labels |
| Micro-labels and table headings | 12px | `.ns-table th`, crumbs, chips |
| Major KPI values | 32px desktop · 24px handheld | scorecard figures |

## What a future North Star must do

1. Use **true white** for ordinary page, card and elevated surfaces.
2. Use the approved **primary / secondary / muted** text hierarchy — no new greys.
3. Use the approved **border and focus** colours for boundaries and focus rings.
4. Use **evergreen deliberately**: brand emphasis, selected states, focus, primary KPI hierarchy.
   Not as a general accent, and not on chrome.
5. **Inherit the shared type tiers**; do not restate font sizes per page.
6. Build with the existing **North Star and operational primitives**. A new component is a last
   resort and needs a reason a primitive cannot cover.
7. Validate at **1440px and 375px** in the routed application, not in isolated mock HTML.
8. **Prove** contrast and responsive behaviour — measured, against the real background.
9. No page-local colour systems and no copied hardcoded palettes. This includes `var(--name, #hex)`
   fallbacks for names that are never declared: that is a hidden second palette, and the test
   catches it.
10. Preserve governed authority and composition boundaries. Presentation never changes what a
    surface may claim, read or do.

### Two rules that are easy to get wrong

**If you change the ground, state the figure.** `index.css` colours the bare `button` element in
both the base and hover states, at a specificity that outranks a single-class rule. Any rule that
re-grounds `background` must declare `color` in that same rule. Skipping it is how the Financials
filter buttons turned white-on-near-white on hover — the defect the Owner found in the pilot.
`buttonForegroundContrast.test.mjs` enforces this in both states.

**`--color-border` is specified against the page/card surface.** It is 3.19:1 on white but 2.90:1 on
`--color-surface-sunken`. A hairline drawn on a recessed surface uses `--color-border-strong`.

## Permitted exceptions

An exception must use an existing semantic token where one exists, and must not introduce an
undocumented parallel palette.

| Exception | Rule |
| --- | --- |
| Warning, refusal, error, destructive | Use `--color-warning` / `--color-danger` and their surfaces. Never colour alone — pair with a word, a weight or a rule. |
| Governed status colours | The status ramp is deliberately outside the brand palette so meanings stay separable. Each must still clear AA on the surface it sits on. |
| Charts needing distinguishable series | Series colours may leave the schema; labels and axes may not. |
| Intentional branded surfaces | Auth, masthead, rail. Bring their readability, contrast and borders into alignment; do not flatten them into an operational table. |
| Accessibility-driven adjustment | Permitted and expected — but prove it against the actual background. `--color-warning` was darkened to `#8F6109` under this clause: `#A9740D` measured 4.05:1 on white and 3.71:1 on its own surface, failing AA for body text on both. |

## Enforcement

`field-ops-app-vite/test/visualSystem.test.mjs` pins the schema (resolved through the token layer,
not matched as text), measures contrast, asserts the type tiers are declared unscoped, and fails if
a superseded value goes live or a shadow token appears.

It is **deliberately not a repository-wide hex scanner**. That test would fail on the status ramp,
on chart series, on branded surfaces, on documented exceptions, and on every historical comment that
records a superseded colour — and it would then be weakened or deleted, taking the real invariant
with it. It reads declarations only, with comments stripped, and names the retired values precisely.
