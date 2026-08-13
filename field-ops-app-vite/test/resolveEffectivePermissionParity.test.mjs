import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const functionalSource = (file) => fs.readFileSync(file, "utf8")
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .join("\n")
  .replace(/\s+/g, " ")
  .trim();

const frontend = functionalSource(path.join(root, "field-ops-app-vite/src/access/resolveEffectivePermission.ts"));
const backend = functionalSource(path.join(root, "functions/src/access/resolveEffectivePermission.ts"));
assert.equal(frontend, backend, "frontend permission preview must stay functionally identical to the backend authority");
console.log("resolveEffectivePermission frontend/backend parity passed");
