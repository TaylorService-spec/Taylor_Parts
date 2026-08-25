// THE ONE PAGE DETECTOR, shared by the static route sweep and the dynamic detail sweep.
//
// WHY IT LIVES HERE. certify.mjs owned this outright and swept routes.json -- 54 NAV destinations,
// none of them a record page, because a detail URL does not exist until a record does. So the sweep
// reported ZERO raw-id findings across 270 visits while SalesOrderDetail was printing a Firestore
// document id as visible content, and the gap was invisible: a clean sweep and a broken page look
// identical from the outside.
//
// Extracted rather than copied. A second detector would drift, and the moment it did, one of the two
// sweeps would start quietly tolerating what the other rejects -- including the intentional
// tolerated classes (OFFSCREEN_IN_SCROLLER, TINY_TARGET_DESKTOP_SURFACE) whose whole value is that
// they mean the same thing everywhere.

export const PROBE = (MOBILE_SURFACE) => {
  const d = document.documentElement;
  const vw = d.clientWidth;
  const out = [];
  const push = (kind, detail) => out.push({ kind, detail: String(detail).slice(0, 120) });
  const name = (el) => (el.tagName + "." + (el.className || "").toString().trim().split(/\s+/).slice(0, 2).join(".")).slice(0, 60);
  const visible = (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";

  if (d.scrollWidth - d.clientWidth > 1) push("OVERFLOW_X", `${d.scrollWidth - d.clientWidth}px`);

  const main = document.querySelector("#fo-main, .fo-main, main") || document.body;
  const text = (main.innerText || "");
  if (text.trim().length < 20) push("EMPTY_PAGE", `only ${text.trim().length} chars of text`);
  for (const pat of [/TypeError|ReferenceError|undefined is not|Cannot read propert|at [A-Za-z]+\.<anonymous>/]) {
    const m = text.match(pat);
    if (m) push("ERROR_TEXT", m[0]);
  }
  // RAW_ID -- A FIRESTORE KEY IS NOT MERELY A LONG WORD, which is what this used to test.
  //
  // The first version matched any 20-character alphanumeric token and duly reported
  // "postPurchasingUpdate" on /administration/roles-permissions at all five widths. That is a
  // CAPABILITY ID: it is supposed to be on that screen, it is the screen's subject matter, and a
  // sweep that calls it a defect is telling the reader to remove the content the page exists to show.
  //
  // The fifth false-positive family in this file, and the same root cause as the other four: the
  // check measured a SHAPE and inferred an INTENT it cannot see. A 20-char word is a shape shared by
  // random keys and ordinary camelCase identifiers alike.
  //
  // Firestore auto-ids are 20 characters drawn from a 62-character alphabet, so a digit appears in
  // roughly 97% of them; hand-written camelCase identifiers essentially never carry one. Requiring a
  // digit keeps the check pointed at random keys and lets the vocabulary this app is built to
  // display through. It will miss the ~3% of genuine ids that happen to be all-letters -- the right
  // trade, because a false positive here asks someone to delete correct content.
  const rawId = (text.match(/\b[A-Za-z0-9]{20}\b/g) || []).find((t) => /[0-9]/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t));
  if (rawId) push("RAW_ID", rawId);

  const controls = [...main.querySelectorAll("button,a,input,select,textarea,[role=button],[role=tab]")].filter(visible);
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    // OFFSCREEN, BUT REACHABLE, IS NOT A DEFECT -- and this check could not tell the difference.
    //
    // It compared the control's viewport rect against the viewport width and stopped there. A
    // control sitting inside a deliberately horizontally-scrollable container is outside the
    // viewport and perfectly reachable by scrolling that container, which is the entire point of
    // the container. The Scheduling board is exactly this: a 7-day grid whose overflow is
    // scroll-contained ON PURPOSE, documented as such in its own component. It was being reported
    // as broken at EVERY width, 1440 included, which is what gave the false cluster away -- a real
    // responsive defect does not appear on a wide desktop.
    //
    // This is the fourth false-positive family this sweep has produced (after hash navigation,
    // screen-reader landmarks counted as clipped, and desktop controls measured against a touch
    // floor they never promised). Each one produced a confident, wrong number. The pattern is
    // always the same: geometry alone under-describes intent, so the check has to ask what the
    // page was TRYING to do before calling the result a defect.
    //
    // Reported as a separate kind rather than dropped: a control parked inside a scroller is worth
    // seeing, it is simply not the same finding as one that cannot be reached at all.
    const offscreen = r.right > vw + 1 || r.left < -1;
    if (offscreen) {
      let scroller = null;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const ov = getComputedStyle(a).overflowX;
        if ((ov === "auto" || ov === "scroll") && a.scrollWidth > a.clientWidth + 1) { scroller = a; break; }
      }
      const where = `${name(el)} @${Math.round(r.left)}..${Math.round(r.right)} vw=${vw}`;
      if (scroller) push("OFFSCREEN_IN_SCROLLER", `${where} (reachable inside ${scroller.className || scroller.tagName})`);
      else push("OFFSCREEN_CONTROL", where);
    }
    // TOUCH TARGETS ARE ONLY PROMISED ON SURFACES MEANT FOR TOUCH.
    //
    // Flagging every control on the Administration or Reporting screens at 375px would produce a
    // large, alarming and MEANINGLESS number: those are desktop workspaces, and the standard the
    // brief sets for them is "degrade intentionally", not "become a phone app". The handheld
    // surfaces -- technician, scan, inventory-role -- are the ones that promised 44px, and they are
    // the ones held to it.
    if (vw <= 430 && r.height > 0 && r.height < 44) {
      push(MOBILE_SURFACE ? "TINY_TARGET" : "TINY_TARGET_DESKTOP_SURFACE", `${name(el)} h=${Math.round(r.height)}`);
    }
    const p = el.parentElement;
    if (p) {
      const pr = p.getBoundingClientRect();
      if (pr.width > 0 && r.right > pr.right + 2 && getComputedStyle(p).overflowX === "visible") {
        push("ESCAPES_CONTAINER", `${name(el)} past ${name(p)} by ${Math.round(r.right - pr.right)}px`);
      }
    }
  }

  // CLIPPED TEXT -- but NOT the text that is clipped ON PURPOSE.
  //
  // A first run of this sweep reported 174 clipped-text findings across all 54 routes and looked
  // like a catastrophe. 162 of them were the shell's own `<h1 class="fo-visually-hidden">` -- the
  // screen-reader landmark that EXISTS to be clipped, plus .fo-sr-only and .sr-only siblings.
  //
  // That would have been a worse error than missing the defects: an alarming, confident, wrong
  // number. A visually-hidden element is identified by its signature (1px box, or a clip/clip-path,
  // or negative-margin offscreen) and skipped, so what remains is text that is clipped by ACCIDENT.
  const deliberatelyHidden = (el, cs) => {
    // THE CLASS NAME IS THE CONTRACT. `fo-visually-hidden` / `sr-only` are a component stating in so
    // many words that this text is for screen readers and is meant to be clipped. Inferring that
    // from geometry alone proved unreliable, and the honest signal was sitting in the markup.
    const cls = (el.className || "").toString();
    if (/visually-hidden|\bsr-only\b/.test(cls)) return true;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return true;
    if (cs.clipPath && cs.clipPath !== "none") return true;
    if (cs.clip && cs.clip !== "auto") return true;
    if (parseFloat(cs.marginLeft) <= -999 || parseFloat(cs.textIndent) <= -999) return true;
    return false;
  };
  for (const el of [...main.querySelectorAll("*")].filter(visible)) {
    const cs = getComputedStyle(el);
    if (cs.overflow !== "hidden") continue;
    if (deliberatelyHidden(el, cs)) continue;
    if (el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0 && (el.innerText || "").trim().length > 0) {
      push("CLIPPED_TEXT", `${name(el)} ${el.scrollHeight}>${el.clientHeight}`);
    }
  }

  for (const lbl of [...main.querySelectorAll("label")].filter(visible)) {
    const forId = lbl.getAttribute("for");
    const ctrl = forId ? document.getElementById(forId) : lbl.querySelector("input,select,textarea");
    if (!ctrl) { push("DETACHED_LABEL", `${(lbl.innerText || "").trim().slice(0, 40)} -> no control`); continue; }
    const a = lbl.getBoundingClientRect(), b = ctrl.getBoundingClientRect();
    if (b.width && (Math.abs(a.top - b.top) > 140 || Math.abs(a.left - b.left) > 600)) {
      push("DETACHED_LABEL", `${(lbl.innerText || "").trim().slice(0, 30)} dx=${Math.round(Math.abs(a.left - b.left))} dy=${Math.round(Math.abs(a.top - b.top))}`);
    }
  }
  return out;
};
