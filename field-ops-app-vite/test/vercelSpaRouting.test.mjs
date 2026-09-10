// VERCEL SPA ROUTING — a full reload on a client route must reach the app.
//
// The defect this holds shut: on the Vercel project (Root Directory `field-ops-app-vite`), a direct
// hit or reload of any BrowserRouter path -- /administration/roles-permissions, measured -- returned
// HTTP 404. Firebase Hosting has always had its SPA fallback (`** -> /index.html` in firebase.json);
// the Vercel project had none.
//
// Worse than a plain 404: with no rewrite, Vercel falls back to `public/404.html`, which is the
// GitHub Pages SPA shim, tuned with `pathSegmentsToKeep = 2` for the /Taylor_Parts/field-ops/ base. On
// a domain-root deploy it re-encodes the wrong segments and redirects into a mangled path. That file
// is correct for GitHub Pages and is left alone; this rewrite simply means Vercel never reaches it
// for an app route.
//
// WHY `rewrites` AND NOT `routes`: Vercel applies `rewrites` only after the filesystem has been
// checked, so real build output -- /version.json, /assets/*, /favicon.svg -- is still served as
// itself. The legacy `routes` array does NOT check the filesystem first unless told to, and a
// catch-all there would answer /version.json with index.html and quietly break deployed-version
// identity (C3/D1). So the shape of this file is asserted, not just its existence.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const CONFIG_URL = new URL("../vercel.json", import.meta.url);

test("the Vercel project root carries SPA routing authority", () => {
  // The Vercel project's Root Directory is field-ops-app-vite, so this is the file Vercel reads.
  assert.ok(existsSync(CONFIG_URL), "field-ops-app-vite/vercel.json must exist");
});

const config = JSON.parse(readFileSync(CONFIG_URL, "utf8"));

test("exactly one rewrite: every path falls back to /index.html", () => {
  assert.deepEqual(config.rewrites, [{ source: "/(.*)", destination: "/index.html" }]);
});

test("client routes are directed to /index.html", () => {
  // `/(.*)` is a path-to-regexp source; for this pattern its matching is the plain regex below.
  const [{ source, destination }] = config.rewrites;
  const matches = (path) => new RegExp(`^${source}$`).test(path);
  for (const route of [
    "/administration/roles-permissions",
    "/administration/objects",
    "/dashboard",
    "/service/dispatch",
    "/customers/opportunities/4F3bD4p84fjNDQPMbEDv",
  ]) {
    assert.ok(matches(route), `${route} is rewritten`);
  }
  assert.equal(destination, "/index.html");
});

test("it is filesystem-first — nothing that could shadow version.json or assets", () => {
  // `routes` would bypass the filesystem check; redirects/headers/cleanUrls/trailingSlash would be
  // routing authority this file was never meant to hold.
  for (const key of ["routes", "redirects", "headers", "cleanUrls", "trailingSlash"]) {
    assert.equal(config[key], undefined, `vercel.json must not declare "${key}"`);
  }
  assert.deepEqual(Object.keys(config).sort(), ["$schema", "rewrites"]);
});

test("the file the rewrite serves is the one the build emits", () => {
  // index.html is at the build root whatever the asset base is -- `base` changes asset URLs, not
  // where index.html lands -- so /index.html is right for the Vercel build and does not couple this
  // file to VITE_BASE.
  assert.ok(existsSync(new URL("../index.html", import.meta.url)), "the Vite entry index.html exists");
});
