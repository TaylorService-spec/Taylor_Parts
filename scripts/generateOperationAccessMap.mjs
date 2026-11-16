#!/usr/bin/env node
// Generates the browser's per-operation access map from the SERVER's own table.
//
//   functions/src/eosOps/operationAccessMap.ts   (canonical: built from the constants the commands themselves check)
//     -> compiled to functions/lib/eosOps/operationAccessMap.js (npm run build in functions/)
//     -> field-ops-app-vite/src/access/operationAccess.generated.js   (this script's output; never edit it)
//
// USAGE
//   node scripts/generateOperationAccessMap.mjs           regenerate the client file
//   node scripts/generateOperationAccessMap.mjs --check   exit 1 when the committed file differs (CI)
//
// Deterministic: sorted keys, sorted arrays, no timestamps. Needs the Functions build (the same prerequisite as syncAccessContracts' siblings).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_MODULE = path.join(ROOT, "functions", "lib", "eosOps", "operationAccessMap.js");
export const CLIENT_FILE = path.join(ROOT, "field-ops-app-vite", "src", "access", "operationAccess.generated.js");

const BANNER = [
  "// GENERATED FILE -- DO NOT EDIT.",
  "//",
  "// What the SERVER requires of a session for each operation a page may ask. Generated from functions/src/eosOps/operationAccessMap.ts by",
  "// scripts/generateOperationAccessMap.mjs; CI fails on drift. The browser asks this map (access/operationGate.js) before it asks the server.",
  "// It grants nothing: the server re-decides every call, and decides company reach / record assignment / conditions that are not visible here.",
  "",
].join("\n");

export function render(table) {
  const rows = Object.keys(table).sort().map((operation) => {
    const { allOf = [], anyOf, surface } = table[operation];
    const row = { allOf: [...allOf].sort(), ...(anyOf && anyOf.length ? { anyOf: [...anyOf].sort() } : {}), ...(surface ? { surface } : {}) };
    return `  ${operation}: Object.freeze(${JSON.stringify(row)}),`;
  });
  return `${BANNER}export const OPERATION_ACCESS = Object.freeze({\n${rows.join("\n")}\n});\n`;
}

async function main() {
  if (!fs.existsSync(SERVER_MODULE)) {
    console.error(`missing ${path.relative(ROOT, SERVER_MODULE)} -- run "npm run build" in functions/ first`);
    process.exit(2);
  }
  const { OPERATION_ACCESS } = await import(pathToFileURL(SERVER_MODULE).href);
  const next = render(OPERATION_ACCESS);
  if (process.argv.includes("--check")) {
    // A Windows checkout (core.autocrlf) holds the same bytes with CRLF; the repository's own form is LF.
    const current = fs.existsSync(CLIENT_FILE) ? fs.readFileSync(CLIENT_FILE, "utf8").replace(/\r\n/g, "\n") : null;
    if (current !== next) {
      console.error("operationAccess.generated.js is stale: run `node scripts/generateOperationAccessMap.mjs` and commit the result.");
      process.exit(1);
    }
    console.log("operationAccess.generated.js is current.");
    return;
  }
  fs.writeFileSync(CLIENT_FILE, next);
  console.log(`wrote ${path.relative(ROOT, CLIENT_FILE)} (${Object.keys(OPERATION_ACCESS).length} operations)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
