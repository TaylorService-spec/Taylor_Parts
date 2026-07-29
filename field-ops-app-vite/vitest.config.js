// Vitest config for the D6 component render/lifecycle gate. This is the ONLY browser-DOM test harness in
// the repo; it exists so the "Used In Equipment" section can be rendered THROUGH its production prop seam
// with injected fixtures (the section is inert in the running app — equipment.compatibility.view is
// active:false — so it can only be exercised in isolation). The plain-node offline suites keep running via
// `npm test`; this runner is invoked separately by `npm run test:components`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.jsx"],
  },
});
