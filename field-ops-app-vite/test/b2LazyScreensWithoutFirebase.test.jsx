// FIREBASE EXIT B2 -- IMPORT SMOKE: every lazy screen module loads with NO Firebase handles.
//
// In an EOS-only sign-in build the Firebase module is replaced by an inert stand-in whose db, auth and functions are null
// (firebase/firebaseAbsent.js). A screen that touches a handle at MODULE SCOPE (for example `collection(db, ...)`) then throws
// while its lazy chunk evaluates, and the whole screen falls into the route boundary instead of just the one panel that
// needs Firebase. This test imports every module App.jsx lazy-loads, with the three handles null, and fails on any
// module-scope throw. (Handles used INSIDE a function or hook are the screen's own error path and are not in scope here.)
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

vi.mock("../src/firebase/firebase", () => ({ db: null, auth: null, functions: null, APP_ENVIRONMENT: { id: "test", role: "sandbox", deployment: "platform" } }));
vi.mock("../src/firebase/firebase.js", () => ({ db: null, auth: null, functions: null, APP_ENVIRONMENT: { id: "test", role: "sandbox", deployment: "platform" } }));

const modules = import.meta.glob("../src/**/*.{js,jsx,ts,tsx}");
const HERE = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(HERE, "..", "src", "App.jsx"), "utf8");
const lazySpecifiers = [...new Set([...appSource.matchAll(/import\(\s*["'](\.\/[^"']+)["']\s*\)/g)].map((m) => m[1]))];

const keyFor = (spec) => {
  const base = `../src/${normalize(spec).replace(/\\/g, "/").replace(/^\.\//, "")}`;
  return [base, `${base}.jsx`, `${base}.js`, `${base}.tsx`, `${base}.ts`].find((k) => k in modules) ?? null;
};

describe("every lazy screen loads with db, auth and functions null", () => {
  it("App.jsx names a real set of lazy screens (this is not a vacuous walk)", () => {
    expect(lazySpecifiers.length).toBeGreaterThan(40);
    expect(lazySpecifiers.filter((s) => keyFor(s) === null)).toEqual([]);
  });

  it("imports each one without a module-scope throw", async () => {
    const failures = [];
    for (const spec of lazySpecifiers) {
      const key = keyFor(spec);
      if (!key) continue;
      try {
        await modules[key]();
      } catch (err) {
        failures.push(`${spec}: ${String(err?.message ?? err).slice(0, 160)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
