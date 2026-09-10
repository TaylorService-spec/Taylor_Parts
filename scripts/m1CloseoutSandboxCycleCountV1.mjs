#!/usr/bin/env node
// M-1 SANDBOX CLOSEOUT (Owner ruling 2026-09-10, Option A) -- run ONCE, BEFORE the v2 release.
//
// For every v1 cycle count that is still OPEN in the export, cancel it through the DEPLOYED v1
// `cancelCycleCount` command, signed in as the SAME persona that opened it (verified from the ID token,
// not assumed). Cancelling asserts nothing about stock: no count, no decision, no variance, no reason.
// COUNTED records are deliberately NOT touched -- disposing of them would need a reconciliation decision
// nobody made. They stay as inert v1 history, outside the v2 population.
//
//   node scripts/m1CloseoutSandboxCycleCountV1.mjs <export.json> <personaKey>
//
// Sandbox only (the harness is pinned to eos-platform-sandbox). Refuses any other source project.
import { readFileSync } from "node:fs";
import { callAs, idTokenFor } from "./sandboxScannerScenarios.mjs";

const [exportPath, personaKey] = process.argv.slice(2);
if (!exportPath || !personaKey) { console.error("usage: <export.json> <personaKey>"); process.exit(1); }
const exp = JSON.parse(readFileSync(exportPath, "utf8"));
if (exp.sourceProject !== "eos-platform-sandbox") { console.error(`REFUSED: export is from ${exp.sourceProject}; closeout is sandbox-only.`); process.exit(1); }

const token = await idTokenFor(personaKey);
const uid = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).user_id;

const open = exp.documents.filter((d) => d.status === "OPEN");
console.log(`${open.length} OPEN v1 count(s) in the export; persona ${personaKey} = ${uid}`);
let failures = 0;
for (const d of open) {
  if (d.data.createdBy !== uid) {
    console.log(`SKIP ${d.id}: opened by ${d.data.createdBy}, not ${personaKey} -- not cancelled on someone else's behalf`);
    continue;
  }
  const r = await callAs(personaKey, "cancelCycleCount", { cycleCountId: d.id });
  console.log(`${r.ok ? "CANCELLED" : "FAILED   "} ${d.id}  ${r.ok ? `${r.result.outcome} -> ${r.result.status}` : `${r.code} ${String(r.message ?? "").slice(0, 100)}`}`);
  if (!r.ok) failures += 1;
}
process.exit(failures ? 1 : 0);
