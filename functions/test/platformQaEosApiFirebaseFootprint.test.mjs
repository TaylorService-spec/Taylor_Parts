// PLATFORM QA (lane L5) -- THE FIREBASE FOOTPRINT OF THE EOS API PROCESS, measured transitively.
//
// Owner ruling 2026-09-27 (Firebase is retirement-only): the EOS API on Render gains no Firebase access, authority,
// data responsibility or imports; Firebase may say exactly one thing there -- "this bearer token belongs to subject X"
// (src/eosApi/server.ts createFirebaseTokenVerifier). The per-directory no-Firebase guards (adminPolicyNoFirebase,
// eosOpsNoFirebase) each fence ONE source tree by path; neither follows the imports of the process Render actually runs.
// This walks every module reachable from lib/eosApi/server.js (static require AND dynamic import) and pins:
//
//   * the ONLY Firebase package reachable is firebase-admin, imported ONLY by eosApi/server.js, ONLY dynamically;
//   * that module's Firebase use is token verification and nothing else (no Firestore, no Realtime DB, no Storage,
//     no Functions, no custom claims read);
//   * no reachable module names a Firestore collection accessor.
//
// Offline; needs `npm run build` (lib/). A new Firebase dependency anywhere in the Render process fails here, whichever
// directory it is added in.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FUNCTIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(FUNCTIONS_DIR, "lib", "eosApi", "server.js");

function walk(entry) {
  const seen = new Set();
  const external = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/require\("([^"]+)"\)|import\("([^"]+)"\)/g)) {
      const spec = m[1] ?? m[2];
      const dynamic = m[2] !== undefined;
      if (spec.startsWith(".")) {
        let p = path.resolve(path.dirname(file), spec);
        if (!p.endsWith(".js")) p = existsSync(`${p}.js`) ? `${p}.js` : path.join(p, "index.js");
        if (existsSync(p)) visit(p);
      } else {
        external.push({ spec, dynamic, from: path.relative(FUNCTIONS_DIR, file) });
      }
    }
  };
  visit(entry);
  return { modules: [...seen].map((f) => path.relative(FUNCTIONS_DIR, f)), external };
}

test("the EOS API process: Firebase is identity verification, in one module, and nothing else", { skip: existsSync(ENTRY) ? false : "lib/ is not built" }, () => {
  const { modules, external } = walk(ENTRY);
  assert.ok(modules.length > 50, `only ${modules.length} modules reached -- the walk is not following the graph`);
  for (const must of ["lib/adminPolicy/adminPolicyHttp.js", "lib/eosCommercial/commercialHttp.js", "lib/eosCrm/crmHttp.js",
    "lib/eosWorkforce/workforceHttp.js", "lib/eosOps/eosOpsHttp.js", "lib/eosOps/capabilityAuthority.js"]) {
    assert.ok(modules.includes(must), `${must} is not reachable from the entry: the walk is vacuous`);
  }

  const firebase = external.filter((e) => /^(firebase|@firebase|firebase-admin|firebase-functions|@google-cloud\/firestore)(\/|$)/.test(e.spec));
  assert.deepEqual(firebase, [{ spec: "firebase-admin", dynamic: true, from: "lib/eosApi/server.js" }],
    "a Firebase package became reachable from the EOS API process");

  const server = readFileSync(ENTRY, "utf8");
  for (const banned of [/\.firestore\s*\(/, /\.database\s*\(/, /\.storage\s*\(/, /\.messaging\s*\(/, /customClaims/, /getFirestore/,
    /\.collection\s*\(/, /\.doc\s*\(/, /firebase-functions/]) {
    assert.doesNotMatch(server, banned, `eosApi/server.js uses Firebase beyond token verification: ${banned}`);
  }
  assert.match(server, /verifyIdToken\(/);

  const collectionAccess = modules.filter((m) => /\.collection\(\s*["'`]/.test(readFileSync(path.join(FUNCTIONS_DIR, m), "utf8")));
  assert.deepEqual(collectionAccess, [], "a module reachable from the EOS API names a Firestore collection accessor");
});
