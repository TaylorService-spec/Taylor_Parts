// THE CANONICAL EOS VISUAL SYSTEM — the schema every North Star inherits.
// Run: node --test test/visualSystem.test.mjs   (also `npm test`)
//
// ============================ WHAT THIS FILE IS FOR ============================
//
// The Financials pilot (PR #1724) proved a true-white, high-contrast, one-semantic-step-larger
// presentation on one family. The Owner accepted it as the standard for the whole authenticated
// application, and the rollout promoted it: the colours to `:root`, the type step onto the shared
// North Star and operational primitives, and the Financials-only shell seam deleted.
//
// A promotion like that is easy to do once and easy to lose. The failure mode is not a dramatic
// revert — it is the next North Star page that declares `background: #FCFAF6` inside its own block
// because that is what the last design happened to use. Six of those and the system is gone again
// with every individual commit looking reasonable.
//
// So this suite pins THREE things:
//   1. the schema itself, resolved through the token layer, with its contrast measured;
//   2. that the shared type tiers are declared globally, not re-scoped per family;
//   3. that the DEPRECATED palette cannot return as a live declaration.
//
// ============================ WHAT THIS FILE IS NOT ============================
//
// NOT a repository-wide hex scanner. That test would be worse than nothing: it would fail on the
// governed status ramp, on chart series that must stay distinguishable, on branded surfaces, on
// the accessibility-driven exceptions the schema explicitly permits, and on every historical
// comment in this stylesheet that records what a colour USED to be. It would then be weakened or
// deleted, and the real invariant would go with it.
//
// Instead it reads DECLARATIONS ONLY (comments stripped, so history stays sayable), and it names
// the deprecated values precisely rather than guessing from luminance.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const css = readFileSync(path.join(SRC, "index.css"), "utf8");
/** Comments carry the record of superseded colours on purpose; never assert over them. */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");

// ─── contrast ───
const relativeLuminance = (hex) => {
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrastRatio = (a, b) => {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

// ─── the token layer, resolved ───
/** Custom properties declared in the first `:root` block. */
function rootTokens(text) {
  const start = text.indexOf(":root");
  const open = text.indexOf("{", start);
  let depth = 0, end = open;
  for (; end < text.length; end += 1) {
    if (text[end] === "{") depth += 1;
    else if (text[end] === "}") { depth -= 1; if (depth === 0) break; }
  }
  const map = new Map();
  for (const line of text.slice(open + 1, end).split("\n")) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

/** Follow `var(--x)` chains to the literal a component actually paints with. */
function resolve(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`token cycle at ${name}`);
  seen.add(name);
  const value = tokens.get(name);
  assert.ok(value !== undefined, `${name} is not declared in :root`);
  const ref = value.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  return ref ? resolve(tokens, ref[1], seen) : value;
}

const tokens = rootTokens(declarations);

// ═══════════════════════════════════════════════════════════════════════════════
// 1. THE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════

// The Owner's canonical North Star colour schema, verbatim. A future design starts HERE; it does
// not restate these values inside a page.
const CANONICAL = {
  "--color-surface-page": "#FFFFFF",
  "--color-surface-card": "#FFFFFF",
  "--color-surface-elevated": "#FFFFFF",
  "--color-surface-sunken": "#F2F5F3",
  "--color-text-primary": "#111111",
  "--color-text-secondary": "#3F4542",
  "--color-text-muted": "#626A66",
  "--color-brand-secondary": "#005A3C",
  "--color-focus": "#005A3C",
  "--color-border": "#87938D",
  "--color-border-strong": "#5F6C66",
};

test("the canonical schema is declared globally, and resolves to the accepted values", () => {
  for (const [name, expected] of Object.entries(CANONICAL)) {
    assert.equal(
      resolve(tokens, name).toUpperCase(),
      expected,
      `${name} must resolve to ${expected} — this is the ratified schema, not a preference`,
    );
  }
});

test("the schema lives in :root, so every family inherits it without a seam", () => {
  // A rule that re-declares a schema token is a page-local palette wearing the shared names, which
  // is the exact failure the rollout removed when it deleted `.fo-main--financials-pilot`.
  const offenders = [];
  for (const m of declarations.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (sel.includes(":root") || sel.startsWith("@")) continue;
    for (const name of Object.keys(CANONICAL)) {
      if (new RegExp(`(^|[;{\\s])${name}\\s*:`).test(m[2])) offenders.push(`${sel} re-declares ${name}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Schema tokens may only be declared in :root. Re-declaring one in a rule creates a second "
      + "palette under the shared names:\n  " + offenders.join("\n  "),
  );
});

test("brand identity is preserved: the rollout retuned derived steps, not the Verenward ramp", () => {
  // The six identity colours are untouched by design. What changed is the canvas the product is
  // read on, which is a derived step — so this is a presentation migration, not a rebrand.
  const RAMP = {
    "--verenward-evergreen": "#102B24",
    "--verenward-guardian": "#1C4638",
    "--verenward-living": "#6F8F63",
    "--verenward-bronze": "#B08A55",
    "--verenward-stone": "#E8E2D6",
    "--verenward-moon": "#B9C1BE",
  };
  for (const [name, value] of Object.entries(RAMP)) {
    assert.equal(resolve(tokens, name).toUpperCase(), value, `${name} is brand identity and must not move`);
  }
  // Evergreen still carries branded chrome; the rail is not repainted by the emphasis colour.
  assert.equal(resolve(tokens, "--color-brand-primary").toUpperCase(), "#102B24");
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CONTRAST — measured against the surface the text is actually on
// ═══════════════════════════════════════════════════════════════════════════════

test("every text tier reaches WCAG AA on the page and card surface", () => {
  const page = resolve(tokens, "--color-surface-page");
  for (const name of ["--color-text-primary", "--color-text-secondary", "--color-text-muted"]) {
    const ratio = contrastRatio(resolve(tokens, name), page);
    assert.ok(ratio >= 4.5, `${name} is ${ratio.toFixed(2)}:1 on the page surface, below AA (4.5:1)`);
  }
});

test("muted text — the tier most at risk — still passes AA on the sunken surface", () => {
  // Table headers and recessed panels use the sunken step, so the weakest text tier has to be
  // measured against THAT background, not only against white.
  const ratio = contrastRatio(resolve(tokens, "--color-text-muted"), resolve(tokens, "--color-surface-sunken"));
  assert.ok(ratio >= 4.5, `muted text is ${ratio.toFixed(2)}:1 on the sunken surface, below AA`);
});

test("borders and the focus ring are visible as non-text boundaries (WCAG 1.4.11, 3:1)", () => {
  const page = resolve(tokens, "--color-surface-page");
  for (const name of ["--color-border", "--color-border-strong", "--color-focus"]) {
    const ratio = contrastRatio(resolve(tokens, name), page);
    assert.ok(ratio >= 3, `${name} is ${ratio.toFixed(2)}:1 on the page surface, below the 3:1 floor`);
  }
  // DOCUMENTED EXCEPTION. --color-border is 3.19:1 on white but 2.90:1 on the sunken step, so a
  // hairline drawn on a recessed surface uses --color-border-strong instead. That is a rule for
  // authors, not a token defect: the schema pins --color-border against the page/card surface.
  const onSunken = contrastRatio(resolve(tokens, "--color-border-strong"), resolve(tokens, "--color-surface-sunken"));
  assert.ok(onSunken >= 3, `--color-border-strong is ${onSunken.toFixed(2)}:1 on sunken, below 3:1`);
});

test("white text on the emphasis and brand colours passes AA, so filled controls are readable", () => {
  for (const name of ["--color-brand-secondary", "--color-brand-primary"]) {
    const ratio = contrastRatio("#FFFFFF", resolve(tokens, name));
    assert.ok(ratio >= 4.5, `white on ${name} is ${ratio.toFixed(2)}:1, below AA`);
  }
});

test("status colours stay AA on white AND on their own surface, and stay distinguishable", () => {
  // A PERMITTED EXCEPTION IS NOT A PERMISSION TO BE UNREADABLE. The status ramp is deliberately
  // outside the brand palette so meanings stay instantly separable — but each still has to clear
  // AA on the surface it is actually painted on. --color-warning was corrected during this rollout
  // for exactly this reason: #A9740D measured 4.05:1 on white and 3.71:1 on its own surface.
  const pairs = [
    ["--color-success", "--color-success-surface"],
    ["--color-warning", "--color-warning-surface"],
    ["--color-danger", "--color-danger-surface"],
    ["--color-info", "--color-info-surface"],
  ];
  const seen = [];
  for (const [fg, bg] of pairs) {
    const colour = resolve(tokens, fg);
    for (const [label, ground] of [["white", "#FFFFFF"], [bg, resolve(tokens, bg)]]) {
      const ratio = contrastRatio(colour, ground);
      assert.ok(ratio >= 4.5, `${fg} is ${ratio.toFixed(2)}:1 on ${label}, below AA`);
    }
    seen.push(colour.toUpperCase());
  }
  assert.equal(new Set(seen).size, pairs.length, "two status colours collapsed to the same value");
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TYPOGRAPHY — one shared step, on the primitives, unscoped
// ═══════════════════════════════════════════════════════════════════════════════

test("the operational type tiers are declared on the shared primitives, not per family", () => {
  // These are the tiers the Owner's handoff names. They must be reachable by EVERY family, which
  // means the selector is the primitive itself with no ancestor scoping it to one domain.
  const TIERS = {
    ".ns-state": "16px",      // states and important operational copy
    ".ns-table": "15px",      // tables and primary working text
    ".ns-view": "15px",       // collection view chips
    ".fo-filter-btn": "15px", // filter controls
    ".ns-view__count": "13px",
    ".ns-page__crumb": "12px",
  };
  for (const [selector, size] of Object.entries(TIERS)) {
    const rule = new RegExp(`(^|\\})\\s*${selector.replace(".", "\\.")}\\s*\\{[^{}]*font-size:\\s*${size}`, "m");
    assert.match(
      declarations,
      rule,
      `${selector} must declare font-size: ${size} as an unscoped shared rule`,
    );
  }
});

test("the type step did not inflate the established display scale", () => {
  // "One semantic step" applied to the operational tiers that were hard to read. Display headings
  // keep their North Star scale — this is not a blind global font-size increase.
  const DISPLAY = {
    "--font-size-display-sm": "clamp(22px, 2.4vw, 26px)",
    "--font-size-display-md": "clamp(28px, 3.4vw, 36px)",
    "--font-size-display-lg": "clamp(36px, 4.6vw, 48px)",
  };
  for (const [name, value] of Object.entries(DISPLAY)) {
    assert.equal(tokens.get(name), value, `${name} must keep its established value`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. THE DEPRECATED PALETTE CANNOT COME BACK
// ═══════════════════════════════════════════════════════════════════════════════

test("no superseded surface, text or border value is live anywhere in the stylesheet", () => {
  // Named precisely, with the role each one used to play, so a failure explains itself rather than
  // just reporting "a hex". Comments are already stripped, so the historical record of these
  // values — including the reasoning blocks that cite them — remains valid and untouched.
  const RETIRED = {
    "#F3F0E9": "the old warm page canvas — use --color-surface-page",
    "#FCFAF6": "the old warm card surface — use --color-surface-card",
    "#EDE8DE": "the old recessed surface — use --color-surface-sunken",
    "#D9D3C6": "the old hairline (1.35:1) — use --color-border",
    "#C3BCAB": "the old strong hairline (1.75:1) — use --color-border-strong",
    "#4A5B55": "the old secondary text — use --color-text-secondary",
    "#6B7A74": "the old muted text — use --color-text-muted",
    "#A9740D": "the warning colour that failed AA (4.05:1) — use --color-warning",
    "#D8D5CF": "a pre-token hairline fallback — use --color-border",
  };
  const offenders = [];
  declarations.split("\n").forEach((line, index) => {
    for (const [hex, why] of Object.entries(RETIRED)) {
      if (line.toUpperCase().includes(hex)) offenders.push(`index.css:${index + 1}  ${hex} — ${why}`);
    }
  });
  assert.deepEqual(
    offenders,
    [],
    "Superseded palette values are live again. Reach for the semantic token instead:\n  "
      + offenders.join("\n  "),
  );
});

test("no shadow token: a var() fallback may not smuggle in a second palette", () => {
  // `var(--color-surface-raised, #FCFAF6)` looks like a token and renders like a hardcoded colour,
  // because that name was never declared. The rollout replaced 36 of these. The declared-token
  // check above cannot see them, so they get their own guard.
  const declared = new Set(
    declarations.split("\n").map((l) => l.trim())
      .filter((l) => l.startsWith("--") && l.includes(":"))
      .map((l) => l.slice(0, l.indexOf(":")).trim()),
  );
  const offenders = new Map();
  for (const m of declarations.matchAll(/var\(\s*(--[a-z0-9-]+)\s*,\s*([^();]*?)\)/gi)) {
    // A numeric/layout variable set at runtime by a component is not a palette; colours are.
    if (!declared.has(m[1]) && /#|rgb|hsl/i.test(m[2])) offenders.set(m[1], m[2].trim());
  }
  assert.deepEqual(
    [...offenders],
    [],
    "These names are never declared, so their hardcoded colour fallback is what actually renders:\n  "
      + [...offenders].map(([n, v]) => `${n} -> ${v}`).join("\n  "),
  );
});
