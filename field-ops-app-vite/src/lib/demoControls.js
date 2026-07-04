// Console-accessible controls for demo day. Imported once for its
// side effects (see main.jsx) so these are available in the browser
// console without any UI -- a presenter can type `enablePanicMode()`
// mid-demo if something starts going wrong, without reloading the page
// or finding a URL bar.

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
    ENV: window.location.search,
    PANIC_MODE: window.__PANIC_MODE__,
  });
};
