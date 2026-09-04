// I-1H — AppHeader host-path invariant.
//
// Gate 2: the "Refresh" full-reload link this suite was originally written for
// has been REMOVED. Persona review (all four personas concurring) found it
// shipped a browser function as application chrome, sitting beside "Home"
// looking identical while doing something entirely different — and "Home" was
// itself a second navigation axis, which Option B's single-axis rail exists to
// eliminate.
//
// The invariant that mattered survives and is asserted more strongly here: the
// header must never hard-code a host path. Removing the link removes that class
// of bug outright rather than merely deriving it correctly. Build-time per-mode
// base resolution remains proven separately by verifyBuildBase.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }

const header = fs.readFileSync(new URL("../src/shared/ui/AppHeader.jsx", import.meta.url), "utf8");

console.log("appHeaderBase.test.mjs");

check("no hard-coded /Taylor_Parts/field-ops navigation URL remains in AppHeader", () => {
  assert.ok(
    !header.includes("/Taylor_Parts/field-ops"),
    "AppHeader still contains a hard-coded /Taylor_Parts/field-ops path",
  );
});

check("no hard-coded host-path or absolute-URL href", () => {
  assert.ok(!/href="\/Taylor_Parts/.test(header), "AppHeader still hard-codes a host-path href");
  assert.ok(!/href="https?:\/\//.test(header), "AppHeader must not hard-code an absolute URL");
});

check("the second navigation axis is gone — the rail is the only one", () => {
  // A <Link to="/dashboard"> here duplicated the rail's own Dashboard
  // destination; the full-reload link duplicated the browser's reload button.
  assert.ok(!header.includes('to="/dashboard"'), "AppHeader must not re-introduce a Home nav link");
  assert.ok(
    !header.includes("import.meta.env.BASE_URL"),
    "AppHeader must not re-introduce the full-reload Refresh link",
  );
});

console.log(`\nappHeaderBase: ${passed} passed, 0 failed`);

// ── THE ACCOUNT CONTROLS MOVED, AND MUST NOT COME BACK ─────────────────────────────────────────
//
// The rail's identity block (AppRail.jsx RailIdentity) is the canonical account surface: governed
// display name, governed role label, Sign out. The header carried a SECOND copy -- the signed-in
// email and a Logout button -- so the shell offered two sign-outs and stated the identity twice,
// once as an email address and once as a name.
//
// These are shell-level guards, not dashboard ones: the strip is above every route for every role.

const rail = fs.readFileSync(new URL("../src/navigation/AppRail.jsx", import.meta.url), "utf8");

/** Comments stripped. These guards describe what the header RENDERS, and the file necessarily
  * explains in prose the very controls it must no longer carry -- a guard that reads its own
  * documentation is a guard that fails for the wrong reason and then gets deleted. */
function stripComments(src) {
  const out = [];
  let inBlock = false;
  for (const line of src.split(String.fromCharCode(10))) {
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; continue; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; continue; }
    if (t.startsWith('//')) continue;
    if (t.startsWith('{/*')) { if (!t.includes('*/}')) inBlock = true; continue; }
    out.push(line);
  }
  return out.join(String.fromCharCode(10));
}
const headerCode = stripComments(header);
const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

check("the header carries no signed-in email and no Logout control", () => {
  assert.ok(!headerCode.includes("fo-appheader-email"), "the signed-in email is back in the header");
  assert.ok(!headerCode.includes("Logout"), "a Logout control is back in the header");
  assert.ok(!headerCode.includes("logout"), "the header reaches for logout again -- sign-out belongs to the rail");
});

check("the dead email rule is gone from the stylesheet too", () => {
  // A class nothing renders is a rule a future reader will try to satisfy.
  assert.ok(!css.includes(".fo-appheader-email"), "the .fo-appheader-email rule outlived its markup");
});

check("the rail keeps the ONE identity block: name, role, Sign out", () => {
  assert.match(rail, /fo-rail-identity/);
  assert.match(rail, /Sign out/);
  assert.match(rail, /fo-rail-identity__name/);
  assert.match(rail, /fo-rail-identity__role/);
});

check("sign-out is ONE implementation, taken from the auth context", () => {
  // Not a copied handler: the rail calls the same `logout` useAuth() has always supplied. A second
  // implementation is how sign-out and session teardown drift apart.
  assert.ok(rail.includes("const { user, role, displayName, logout } = auth;"), "the rail no longer reads logout from the auth context");
  assert.ok(rail.includes("onClick={logout}"), "the rail sign-out no longer calls the context logout");
  const signOutHandlers = rail.split("onClick={logout}").length - 1;
  assert.equal(signOutHandlers, 1, "more than one sign-out control in the rail");
});

check("the strip collapses when it would otherwise be an empty ruled band", () => {
  // Its remaining jobs are the notification bell and, at drawer widths, the navigation opener. A
  // technician on a desktop has neither -- rendering the element anyway would leave a 48px surface
  // with a bottom border announcing a region that contains nothing.
  assert.ok(headerCode.includes("if (!onOpenNav && !canSeeReorderRequests) return null;"), "the empty-strip collapse is gone");
  // AFTER the hooks, or hook order changes between renders.
  const guardAt = headerCode.indexOf("if (!onOpenNav && !canSeeReorderRequests) return null;");
  const lastHook = Math.max(headerCode.lastIndexOf("useMemo("), headerCode.lastIndexOf("useReorderRequests"));
  assert.ok(guardAt > lastHook, "the early return sits above a hook");
});

check("the header still carries the drawer-width navigation opener", () => {
  // The rail is off-canvas at drawer widths. Removing the strip outright would have made navigation
  // unreachable on a handheld -- which is why only the account section went, not the row.
  // The EXACT className, not a substring: renaming it to fo-navtoggle-removed still contains
  // "fo-navtoggle", and a guard that a rename walks straight through is not a guard.
  assert.ok(headerCode.includes(String.fromCharCode(99,108,97,115,115,78,97,109,101,61,34) + "fo-navtoggle\""), "the drawer-width navigation opener is gone");
  assert.ok(headerCode.includes('aria-label="Open navigation"'), "the opener lost its accessible name");
});
