// PERSONA CAPABILITY PARITY (Firebase exit F1-0) -- what changes for each persona if the shell's capability feed and
// the legacy-role gates move from Firebase to EOS Core. MEASUREMENT ONLY: it reads two captures per persona and decides
// nothing. The F1-1 cutover waits for the Owner's rulings (a)-(e) made against this table.
//
// Usage (after `npm run build` in functions/):
//   node scripts/firebaseExit/personaCapabilityParity.mjs --captures <dir> [--out <report.md>] [--json <report.json>]
//
// <dir> holds one <persona>.json per persona, written by a read-only operator capture (no tokens or credentials):
//   {
//     "persona": "dispatcher",
//     "users":  { "role": "dispatcher", "employeeId": "..." } | null,         // Firestore users/{uid} (also read as "usersDoc")
//     "employeeDoc": { "status": 200, "operationalRoles": [] },                  // employees/{employeeId} (G6 input)
//     "usersDocTechnicianId": null,                                              // users/{uid}.technicianId (G7 input)
//     "old":    { "accessVersion": 3, "decisions": { "<shell id>": true|false, ... } },          // resolveEffectiveAccessCallable
//     "new":    { "heldRoleKeys": ["dispatcher"], "capabilities": ["workOrder.create", ...] }    // EOS resolveMyCapabilities
//   }
// A persona with no users doc has no Firebase role, employee or technician by construction. A persona WITH one whose gate
// input was not captured gets UNVERIFIED for that gate, never a guessed DENY.
// "old" is the live answer of the Firebase feed the shell reads every session; "new" is the live EOS answer. Neither side
// is recomputed here, so no reimplementation can disagree with the system it measures.
//
// THE 51 IDS are the shell's own request (field-ops-app-vite/src/access/shellCapabilityGates.js). An id is compared with
// the SAME-NAMED EOS key only: renaming a Firebase permission onto a different EOS key is Owner ruling (a), so an id with
// no same-named EOS key is reported as UNMAPPED, never guessed.
//
// THE LEGACY-ROLE GATES are the screens that still decide from Firestore users.role (f1-session-capability-map §1). Their
// OLD outcome is evaluated with the same logic the screen uses (the role predicate, or the same compatibility-catalog
// preview Jobs / NotificationControl use). Their NEW column is a CANDIDATE EOS capability -- a proposal for Owner ruling
// (b), labelled as such -- or "no candidate" where none exists.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = resolve(HERE, "../..");
const REPO = resolve(FUNCTIONS, "..");
const require = createRequire(import.meta.url);

/** The 51 ids the shell requests from the Firebase feed, from the client module itself. */
export async function shellIds() {
  const url = pathToFileURL(join(REPO, "field-ops-app-vite/src/access/shellCapabilityGates.js")).href;
  return [...(await import(url)).SHELL_GATED_CAPABILITY_IDS];
}

/** Every capability key the EOS migrations name (a quoted dotted key in functions/migrations/*.sql). */
export function eosKeysFromMigrations(dir = join(FUNCTIONS, "migrations")) {
  const keys = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/'([a-z][A-Za-z]*(?:\.[A-Za-z]+){1,4})'/g)) keys.add(m[1]);
  }
  return keys;
}

/** The client's previewHasPermission (navPermissionPreview.js) over the canonical compiled resolver and catalog. */
export function makeRolePreview(activationOverrides) {
  const { resolveEffectivePermission } = require(join(FUNCTIONS, "lib/access/resolveEffectivePermission.js"));
  const { COMPATIBILITY_ROLES } = require(join(FUNCTIONS, "lib/access/compatibilityRoles.js"));
  const overrides = new Set(activationOverrides);
  return (permissionId, role, fallback) => {
    if (!COMPATIBILITY_ROLES[role]) return fallback;
    try {
      return resolveEffectivePermission({
        permissionId,
        assignments: [{ id: `preview-${role}`, principalUid: "preview", roleId: role, scope: { type: "global" }, grantedBy: "preview",
          grantedAt: { toMillis: () => 0 }, status: "active", accessVersionAtGrant: 1 }],
        roles: COMPATIBILITY_ROLES, currentAccessVersion: 1, target: { scope: { type: "global" }, condition: {} },
        activationOverrides: overrides,
      }).decision === "ALLOW";
    } catch { return fallback; }
  };
}

/** The sandbox build's activation overrides (what CAPABILITY_ACTIVATION_OVERRIDE_SET holds in that bundle). */
export function sandboxActivationOverrides() {
  const registry = JSON.parse(readFileSync(join(REPO, "config/environments.json"), "utf8"));
  return registry.environments.find((e) => e.id === "platform-sandbox")?.capabilityActivationOverrides ?? [];
}

const OFFICE = (role) => role === "admin" || role === "dispatcher";

/** The legacy-role gates. `candidate` is a PROPOSAL for Owner ruling (b), never a decision. */
export const GATES = Object.freeze([
  { id: "G1", surface: "Dispatch Board renders (DispatcherBoard.jsx:502)", old: ({ role }) => OFFICE(role), candidate: ["workOrder.lifecycle.schedule"] },
  { id: "G1-alt", surface: "Dispatch Board renders: ALTERNATIVE candidate (the board's EOS nav surface service.dispatch is earned by dispatch; schedule and dispatch are separate board controls since #2116)",
    old: ({ role }) => OFFICE(role), candidate: ["workOrder.lifecycle.dispatch"] },
  { id: "G2", surface: "Jobs: New Work Order (Jobs.jsx:78)", old: ({ role }, preview) => preview("workOrder.create", role, OFFICE(role)), candidate: ["workOrder.create"] },
  { id: "G3", surface: "Reorder queue notifications (NotificationControl.jsx:65)", old: ({ role }, preview) => preview("reorder.request.read.queue", role, OFFICE(role)), candidate: ["reorder.request.read.queue"] },
  { id: "G4", surface: "Work Order office actions: Ready/Schedule/Dispatch/Close/Cancel/Unschedule (workOrderWorkflow.js ACTION_PERMISSIONS, WorkOrderDetailPage.jsx:329)", old: ({ role }) => OFFICE(role),
    candidate: ["workOrder.lifecycle.ready", "workOrder.lifecycle.schedule", "workOrder.lifecycle.dispatch", "workOrder.lifecycle.close", "workOrder.lifecycle.cancel"] },
  { id: "G5", surface: "Account governed-field pencils (AccountDetail.jsx:377)", old: ({ role }) => role === "admin", candidate: null },
  { id: "G6", surface: "Request Reorder control (RequestReorderControl.jsx:66)", needs: ["operationalRoles"],
    old: ({ role, operationalRoles }) => role === "admin" || operationalRoles.includes("PARTS_MANAGER") || operationalRoles.includes("WAREHOUSE_MANAGER"),
    candidate: ["reorder.request.create.manual"] },
  { id: "G7", surface: "Scan: technician Work Order workflow (scanWorkflows.js:305)", needs: ["technicianId"], old: ({ role, technicianId }) => role === "technician" && Boolean(technicianId),
    candidate: ["workOrder.execution.record"], note: "EOS also requires SERVICE_TECHNICIAN work eligibility (experience context), not in this capture" },
  { id: "G8", surface: "Parts shadow-parity diagnostics (PartsShadowParityDiagnostics.jsx:21)", old: ({ role }) => OFFICE(role), candidate: null },
]);

/** EQUAL / WIDEN / NARROW for a same-named key; UNMAPPED_ALLOW / UNMAPPED_DENY when EOS has no key of that name. */
export function classify(oldAllow, eosHasKey, newAllow) {
  if (!eosHasKey) return oldAllow ? "UNMAPPED_ALLOW" : "UNMAPPED_DENY";
  if (oldAllow === newAllow) return "EQUAL";
  return newAllow ? "WIDEN" : "NARROW";
}

export function loadCaptures(dir) {
  return readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith("_")).sort().map((n) => {
    const c = JSON.parse(readFileSync(join(dir, n), "utf8"));
    if (!c.persona || !c.old?.decisions || !Array.isArray(c.new?.capabilities)) {
      throw new Error(`${n}: a capture needs persona, old.decisions and new.capabilities`);
    }
    // A failed read is not a measurement: refuse it rather than read an error as "denies everything".
    if (c.old.error || (c.old.status !== undefined && c.old.status !== 200) || (c.new.status !== undefined && c.new.status !== 200)) {
      throw new Error(`${n}: a capture side did not succeed (old ${c.old.status ?? "?"}, new ${c.new.status ?? "?"})`);
    }
    const users = c.users ?? c.usersDoc ?? null;
    // The capture writes an absent users doc as {}: no doc, not a doc with uncaptured fields.
    return { ...c, users: users && Object.keys(users).length ? users : null };
  });
}

/**
 * What the legacy gates read under a FIREBASE session: role = users/{uid}.role, operationalRoles =
 * employees/{employeeId}.operationalRoles (employeeSession.js), technicianId = users/{uid}.technicianId (useCurrentTechnician).
 * undefined = the persona has a users doc but that input was not captured (the gate is then UNVERIFIED).
 */
export function gateInputs(c) {
  if (!c.users) return { role: null, operationalRoles: [], technicianId: null };
  const emp = c.employeeDoc;
  const operationalRoles = !c.users.employeeId ? [] : emp && !emp.error && emp.status === 200 ? emp.operationalRoles ?? [] : undefined;
  return { role: c.users.role ?? null, operationalRoles, technicianId: "usersDocTechnicianId" in c ? c.usersDocTechnicianId : undefined };
}

export function measure({ ids, eosKeys, captures, preview, widenNotes = {} }) {
  const known = new Set([...eosKeys, ...captures.flatMap((c) => c.new.capabilities)]);
  const personas = captures.map((c) => {
    const held = new Set(c.new.capabilities);
    const cells = Object.fromEntries(ids.map((id) => {
      // A missing answer is not a DENY: refuse it, as a failed capture side is refused.
      if (typeof c.old.decisions[id] !== "boolean") throw new Error(`${c.persona}: old.decisions has no answer for ${id}`);
      const oldAllow = c.old.decisions[id];
      const newAllow = held.has(id);
      return [id, { old: oldAllow, new: known.has(id) ? newAllow : null, class: classify(oldAllow, known.has(id), newAllow) }];
    }));
    const inputs = gateInputs(c);
    const gates = Object.fromEntries(GATES.map((g) => {
      const newAllow = g.candidate ? g.candidate.every((k) => held.has(k)) : null;
      if ((g.needs ?? []).some((k) => inputs[k] === undefined)) return [g.id, { old: null, new: newAllow, class: "UNVERIFIED" }];
      const oldAllow = g.old(inputs, preview);
      if (!g.candidate) return [g.id, { old: oldAllow, new: null, class: "NO_CANDIDATE" }];
      return [g.id, { old: oldAllow, new: newAllow, class: classify(oldAllow, true, newAllow) }];
    }));
    return { persona: c.persona, note: c.note ?? null, legacyRole: inputs.role, heldRoleKeys: c.new.heldRoleKeys ?? [], cells, gates,
      widenNote: widenNotes[c.persona] ?? null };
  });
  return { ids, personas };
}

const MARK = { EQUAL: "=", WIDEN: "W", NARROW: "N", UNMAPPED_ALLOW: "N?", UNMAPPED_DENY: "·", NO_CANDIDATE: "—", UNVERIFIED: "?" };
const oldWord = (v) => (v === null ? "UNVERIFIED (input not captured)" : v ? "ALLOW" : "DENY");

export function toMarkdown({ ids, personas }) {
  const head = `| id | ${personas.map((p) => p.persona).join(" | ")} |\n|---|${personas.map(() => "---").join("|")}|`;
  const rows = ids.map((id) => `| \`${id}\` | ${personas.map((p) => `${MARK[p.cells[id].class]}${p.cells[id].class === "EQUAL" ? (p.cells[id].old ? "✓" : "") : ""}`).join(" | ")} |`);
  const gateRows = GATES.map((g) => `| ${g.id} | ${g.surface} | ${g.candidate ? g.candidate.map((k) => `\`${k}\``).join(", ") : "no candidate"} | ${personas.map((p) => {
    const r = p.gates[g.id]; return `${r.old === null ? "old?" : r.old ? "old✓" : "old✗"}/${r.new === null ? "—" : r.new ? "new✓" : "new✗"} ${MARK[r.class]}`; }).join(" | ")} |`);
  const counts = {};
  for (const p of personas) for (const c of [...Object.values(p.cells), ...Object.values(p.gates)]) counts[c.class] = (counts[c.class] ?? 0) + 1;
  const diffs = personas.flatMap((p) => [
    ...ids.filter((id) => !["EQUAL", "UNMAPPED_DENY"].includes(p.cells[id].class)).map((id) => `- **${p.persona}** \`${id}\`: ${p.cells[id].class} (old ${p.cells[id].old ? "ALLOW" : "DENY"} → new ${p.cells[id].new === null ? "no EOS key" : p.cells[id].new ? "ALLOW" : "DENY"})${p.cells[id].class === "WIDEN" && p.widenNote ? ` -- ${p.widenNote}` : ""}`),
    ...GATES.filter((g) => !["EQUAL"].includes(p.gates[g.id].class)).map((g) => `- **${p.persona}** gate ${g.id}: ${p.gates[g.id].class} (old ${oldWord(p.gates[g.id].old)} → new ${p.gates[g.id].new === null ? "no candidate" : p.gates[g.id].new ? "ALLOW" : "DENY"})`),
  ]);
  return [
    "# Persona capability parity: Firebase feed vs EOS Core (F1-0)",
    "",
    `Legend: \`=✓\` both allow · \`=\` both deny · \`W\` WIDEN (EOS allows, Firebase denied) · \`N\` NARROW (EOS denies, Firebase allowed) · \`N?\` Firebase allows and EOS has no same-named key (lost unless mapped, ruling (a)) · \`·\` neither has it under this name.`,
    "",
    `Totals: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    "",
    "## The 51 shell capability ids",
    "",
    `Legacy role: ${personas.map((p) => `${p.persona}=${p.legacyRole ?? "none"}`).join(", ")}.`,
    ...personas.filter((p) => p.note || p.widenNote).map((p) => `- **${p.persona}**: ${[p.note, p.widenNote && `WIDEN rows ${p.widenNote}`].filter(Boolean).join("; ")}`),
    "",
    head, ...rows,
    "",
    "## The legacy-role gates (new column = CANDIDATE capability, a proposal for ruling (b))",
    "",
    "OLD is each gate under a **Firebase** session: role = `users/{uid}.role`, operationalRoles = `employees/{employeeId}.operationalRoles`, technicianId = `users/{uid}.technicianId`. Under an EOS session `role` is null today (no frontend role map), so every role gate is DENY there. `?` = UNVERIFIED: a gate input was not captured.",
    "",
    `| gate | surface | candidate EOS capability | ${personas.map((p) => p.persona).join(" | ")} |`,
    `|---|---|---|${personas.map(() => "---").join("|")}|`,
    ...gateRows,
    "",
    "## Every difference, named",
    "",
    ...(diffs.length ? diffs : ["- none"]),
    "",
  ].join("\n");
}

async function main(argv) {
  const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const dir = arg("--captures");
  if (!dir) throw new Error("usage: personaCapabilityParity.mjs --captures <dir> [--out <report.md>] [--json <report.json>]");
  // --widen-note <persona>=<text>, repeatable: an operator-supplied explanation printed beside that persona's WIDEN rows.
  const widenNotes = {};
  argv.forEach((a, i) => { if (a === "--widen-note") { const [k, ...v] = argv[i + 1].split("="); widenNotes[k] = v.join("="); } });
  const report = measure({ ids: await shellIds(), eosKeys: eosKeysFromMigrations(), captures: loadCaptures(dir),
    preview: makeRolePreview(sandboxActivationOverrides()), widenNotes });
  const md = toMarkdown(report);
  if (arg("--out")) writeFileSync(arg("--out"), md); else process.stdout.write(md);
  if (arg("--json")) writeFileSync(arg("--json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
