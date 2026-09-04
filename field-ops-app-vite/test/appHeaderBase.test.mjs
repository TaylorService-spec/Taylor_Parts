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


check("the header still carries the drawer-width navigation opener", () => {
  // The rail is off-canvas at drawer widths. Removing the strip outright would have made navigation
  // unreachable on a handheld -- which is why only the account section went, not the row.
  // The EXACT className, not a substring: renaming it to fo-navtoggle-removed still contains
  // "fo-navtoggle", and a guard that a rename walks straight through is not a guard.
  assert.ok(headerCode.includes(String.fromCharCode(99,108,97,115,115,78,97,109,101,61,34) + "fo-navtoggle\""), "the drawer-width navigation opener is gone");
  assert.ok(headerCode.includes('aria-label="Open navigation"'), "the opener lost its accessible name");
});


// ── THE BELL LEFT TOO ──────────────────────────────────────────────────────────────────────────
//
// Notifications moved to the rail footer, beside the account block, where a person looks for their
// own things. The header no longer owns any of it -- not the panel, not the reads, not the gate.

const shell = fs.readFileSync(new URL("../src/navigation/AppShell.jsx", import.meta.url), "utf8");
const control = fs.readFileSync(new URL("../src/shared/ui/NotificationControl.jsx", import.meta.url), "utf8");

check("the header owns no notification behaviour at all", () => {
  for (const gone of ["NotificationPanel", "useReorderRequests", "canSeeReorderRequests",
                      "partsAttentionItems", "useCanonicalPartNames", "previewHasPermission",
                      "accessVersion"]) {
    assert.ok(!headerCode.includes(gone), gone + " is back in the header");
  }
});

check("the header is the navigation opener and nothing else", () => {
  // Its contents are ONE value; the guard reads that value rather than restating its condition.
  assert.ok(headerCode.includes("const contents = [navToggle].filter(Boolean);"));
  assert.ok(headerCode.includes("if (contents.length === 0) return null;"), "the empty-strip collapse is gone");
  assert.ok(!headerCode.includes("if (!onOpenNav)"), "the guard went back to restating the condition");
  // A docked desktop passes no opener, so the strip renders nothing -- for EVERY role now, admin
  // included. The bell no longer justifies a top band.
  assert.ok(!headerCode.includes("fo-appheader-right"), "the empty right-hand container survived");
});

check("the drawer-width navigation opener survived the move", () => {
  assert.ok(headerCode.includes(String.fromCharCode(99,108,97,115,115,78,97,109,101,61,34) + "fo-navtoggle\""), "the opener is gone");
  assert.ok(headerCode.includes('aria-label="Open navigation"'), "the opener lost its accessible name");
});

check("the notification control was MOVED, not rebuilt -- it owns its own gate", () => {
  // The rail renders it for every principal, so the gate must live INSIDE. At the call site, every
  // signed-in person would start loading the reorder queue merely because everyone has a rail.
  assert.ok(control.includes("if (!canSeeReorderRequests) return null;"), "the control lost its own gate");
  assert.ok(control.includes("enabled: canSeeReorderRequests"), "the canonical-name read is no longer gated");
  // The same four governed reads, the same projection, the same permission preview.
  for (const kept of ["useReorderRequests", "useReorderRequestsByStatus", "useReorderRequestsAssignedTo",
                      "partsAttentionItems", "groupPartsAttentionItemsBySection",
                      "reorder.request.read.queue", "NotificationPanel"]) {
    assert.ok(control.includes(kept), kept + " was lost in the move");
  }
  // Authority stays capability-driven: no persona branching was introduced.
  assert.ok(!/role === "technician"|role === "user"/.test(control), "a persona branch appeared");
});

check("the rail footer puts notifications ABOVE identity, and both outside <nav>", () => {
  const notifAt = shell.indexOf("<NotificationControl");
  const identAt = shell.indexOf("<RailIdentity />");
  assert.ok(notifAt > 0 && identAt > 0, "the footer lost a member");
  assert.ok(notifAt < identAt, "identity now renders above notifications");
  assert.ok(shell.includes('<div className="fo-rail__footer">'), "the footer wrapper is gone");
  // NOT inside RailIdentity: that component states who you are and how to leave, and a live queue
  // does not belong inside it.
  const rail = fs.readFileSync(new URL("../src/navigation/AppRail.jsx", import.meta.url), "utf8");
  assert.ok(!rail.includes("NotificationControl"), "notifications were folded into the rail component");
});

check("the handheld drawer carries the SAME footer -- or the bell has no home there", () => {
  // The docked rail is off-canvas at drawer widths. Without this the move would have DELETED
  // notifications on a handheld rather than relocating them.
  const footers = shell.split('<div className="fo-rail__footer">').length - 1;
  assert.equal(footers, 2, "expected the footer in both the docked rail and the drawer");
  const controls = shell.split("<NotificationControl").length - 1;
  assert.equal(controls, 2, "the notification control is not in both shells");
});

check("the panel escapes the two scroll containers it now opens inside", () => {
  // .fo-rail and .fo-drawer are both overflow-y:auto, and a non-visible overflow clips on BOTH
  // axes -- a 320px panel inside a 252px rail would be cut off even after opening upward.
  const railPanel = css.slice(css.indexOf(".fo-rail__notifications .fo-notification-panel-dropdown"));
  const block = railPanel.slice(0, railPanel.indexOf("}"));
  assert.match(block, /position: fixed;/);
  assert.match(block, /box-sizing: border-box;/);  // measured: without it the panel drew 338px
  assert.match(block, /bottom:/);                  // opens upward from the footer
  assert.match(block, /z-index: 42;/);             // above the drawer (41) and its scrim (40)
});

check("exactly ONE NotificationControl is mounted per shell mode", () => {
  // A CSS-HIDDEN COMPONENT IS STILL A MOUNTED ONE. At drawer widths .fo-rail is `display: none`,
  // and `display` suppresses paint, not React hooks. With the docked footer left unconditional, an
  // authorized principal with the drawer open held TWO NotificationControls -- and therefore two
  // copies of every governed reorder subscription, two listeners racing the same data, one of them
  // feeding a surface nobody can see.
  //
  // The mount follows `isDrawer`, which is real state rather than a media query's opinion:
  //   docked            -> the docked footer only
  //   drawer, open      -> the drawer footer only
  //   drawer, closed    -> neither, so no reads at all for a rail that cannot be reached
  assert.ok(shell.includes("{!isDrawer && ("), "the docked footer is unconditional again");
  const dockedAt = shell.indexOf("{!isDrawer && (");
  const drawerAt = shell.indexOf("{isDrawer && drawerOpen && (");
  assert.ok(dockedAt > 0 && drawerAt > 0, "a shell-mode branch is missing");
  assert.ok(dockedAt < drawerAt, "the docked footer must precede the drawer block");
  // Both footers still exist -- this is a lifecycle gate, not a deletion.
  assert.equal(shell.split('<div className="fo-rail__footer">').length - 1, 2);
  assert.equal(shell.split("<NotificationControl").length - 1, 2);
  // The docked footer sits INSIDE the !isDrawer branch, not merely after it.
  const dockedBlock = shell.slice(dockedAt, drawerAt);
  assert.ok(dockedBlock.includes("<NotificationControl"), "the docked control escaped its branch");
  assert.ok(dockedBlock.includes("<RailIdentity />"), "identity escaped the mode gate");
});
