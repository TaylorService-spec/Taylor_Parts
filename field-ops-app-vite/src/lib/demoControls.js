// Console-accessible controls for demo day. Imported once for its
// side effects (see main.jsx) so these are available in the browser
// console without any UI -- a presenter can type `enablePanicMode()`
// mid-demo if something starts going wrong, without reloading the page
// or finding a URL bar.

// Guarded for the same reason config/env.js is: with lazy routes this can evaluate outside a
// browser, and a demo convenience must never be what breaks a build.
if (typeof window !== "undefined") {
window.enablePanicMode = () => {
  window.__PANIC_MODE__ = true;
  console.log("PANIC MODE ENABLED - ALL WRITES BLOCKED");
};

window.disablePanicMode = () => {
  window.__PANIC_MODE__ = false;
  console.log("PANIC MODE DISABLED");
};

window.demoStatus = () => {
  console.log({
    search: window.location.search,
    PANIC_MODE: window.__PANIC_MODE__,
  });
};
}
