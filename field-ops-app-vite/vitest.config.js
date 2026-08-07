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
  // Provide the vite `define` globals (config/environments.json via vite.config.js) to the jsdom test
  // env. O-3/ADR-011 made src/firebase/firebase.js + the readiness configs resolve from these ambient
  // defines; without them here, any component test that imports firebase or a readiness seam throws
  // ReferenceError (__APP_FIREBASE_CONFIG__ / __APP_READINESS__). Test-only synthetic values; the
  // readiness flags mirror the production/sandbox registry (fail-closed where production is).
  define: {
    __APP_COMMIT__: JSON.stringify("test"),
    __APP_ENVIRONMENT__: JSON.stringify({ id: "test-sandbox", role: "sandbox", deployment: "platform" }),
    __APP_FIREBASE_CONFIG__: JSON.stringify({
      apiKey: "test-api-key",
      authDomain: "test.firebaseapp.com",
      projectId: "test-project",
      storageBucket: "test.appspot.com",
      messagingSenderId: "0",
      appId: "test-app-id",
      functionsRegion: "us-central1",
    }),
    __APP_READINESS__: JSON.stringify({
      RECEIVING_TRANSPORT_READY: false,
      TRUCK_MANAGEMENT_WRITE_READY: true,
      PART_MASTER_WRITE_READY: false,
      TRUSTED_COMPLETION_ENABLED: true,
    }),
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.jsx"],
  },
});
