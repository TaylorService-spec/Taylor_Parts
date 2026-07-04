// Demo-day write-safety gate. Independent of demo/demoConfig.js's
// DEMO_MODE (which only seeds Inventory's fixture data -- pure display,
// no Firestore involvement). IS_DEMO/panic mode here is a real safety
// gate: when active, every Firestore write in the app -- job creation,
// dispatch, status updates -- is blocked, so a demo can be driven
// against the same Firestore project the real app uses without risk of
// writing demo data into it, or a stray click during a live
// presentation corrupting production state.
//
// Controlled by a URL param so a shared link decides the mode, not a
// build-time flag:
//   ?env=demo -> IS_DEMO true, writes blocked
//   ?env=prod (or no param) -> writes enabled
const params = new URLSearchParams(window.location.search);

export const ENV = params.get("env") || "prod";

export const IS_DEMO = ENV === "demo";

// Global panic switch -- toggleable from the browser console during a
// live demo (see lib/demoControls.js) without needing to reload with a
// different URL. Read fresh on every isWriteBlocked() call, not cached,
// so toggling it takes effect immediately.
window.__PANIC_MODE__ = window.__PANIC_MODE__ ?? false;

export const isWriteBlocked = () => {
  return IS_DEMO || window.__PANIC_MODE__;
};
