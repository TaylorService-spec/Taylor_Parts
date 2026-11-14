// Turns the per-persona recordings into the machine-readable inventory (JSON) and the persona x page x operation x status matrix (markdown).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** step -> the page it belongs to (the matrix groups by page; the JSON keeps the step). */
export const PAGE_OF_STEP = Object.freeze({
  login: "login",
  catalog: "catalog",
  "part-detail": "part-detail",
  "part-detail-request": "part-detail+requestId",
  receiving: "receiving",
  "catalog-return": "catalog",
  "part-detail-direct": "part-detail",
  "receiving-direct": "receiving",
});

const opLabel = (e) => e.operation ?? `${e.method} ${e.path}`;

export function summarize(entries) {
  const rows = new Map();
  for (const e of entries) {
    const page = PAGE_OF_STEP[e.step] ?? e.step;
    const key = `${page}\u0000${e.step}\u0000${opLabel(e)}\u0000${e.status ?? (e.failure ? "FAILED" : "none")}`;
    rows.set(key, (rows.get(key) ?? 0) + 1);
  }
  return [...rows.entries()].map(([k, count]) => {
    const [page, step, operation, status] = k.split("\u0000");
    return { page, step, operation, status, count };
  }).sort((a, b) => a.page.localeCompare(b.page) || a.step.localeCompare(b.step) || a.operation.localeCompare(b.operation) || a.status.localeCompare(b.status));
}

export function writeReports(outDir, inventory) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "network-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
  writeFileSync(join(outDir, "network-matrix.md"), renderMatrix(inventory));
}

export function renderMatrix(inv) {
  const out = [];
  out.push("# Parts browser network matrix", "");
  out.push(`- Target: \`${inv.target.appUrl}\` (API \`${inv.target.apiOrigin}\`)`);
  out.push(`- Generated: ${inv.generatedAt}`);
  out.push(`- Settle window per page: ${inv.settleMs} ms after network idle`, "");
  out.push("## Refused requests (every 4xx/5xx; only the pre-login `POST /auth/refresh` 401 is tolerated)", "");
  const refused = Object.entries(inv.personas).flatMap(([p, r]) => r.violations.map((v) => ({ persona: p, ...v })));
  if (refused.length === 0) out.push("None.", "");
  else {
    out.push("| Persona | Page | Request | Status | Server code | Count |", "|---|---|---|---|---|---|");
    const grouped = new Map();
    for (const v of refused) {
      const k = [v.persona, `${PAGE_OF_STEP[v.step] ?? v.step} (${v.step})`, opLabel(v), v.status ?? v.failure, v.code ?? ""].join("|");
      grouped.set(k, (grouped.get(k) ?? 0) + 1);
    }
    for (const [k, n] of grouped) { const [persona, page, req, status, code] = k.split("|"); out.push(`| ${persona} | ${page} | \`${req}\` | ${status} | ${code} | ${n} |`); }
    out.push("");
  }
  for (const [persona, r] of Object.entries(inv.personas)) {
    out.push(`## ${r.label} (${persona})`, "");
    out.push(`Requests: ${r.requestCount}; refused: ${r.violations.length}; capabilities seen via resolveMyCapabilities: ${r.capabilities ? r.capabilities.length : "not captured"}`, "");
    if (r.parity) out.push(`Grant parity vs expected: ${r.parity.equal ? "IDENTICAL" : `DIFFERS (missing ${r.parity.missing.length}, extra ${r.parity.extra.length})`}`, "");
    out.push("| Page | Step (direct load or in-app) | Operation / request | Status | Count |", "|---|---|---|---|---|");
    for (const row of r.matrix) out.push(`| ${row.page} | ${row.step} | \`${row.operation}\` | ${row.status} | ${row.count} |`);
    out.push("");
    if (r.visibility.length > 0) {
      out.push("Positive visibility checks:", "");
      for (const v of r.visibility) out.push(`- ${v.ok ? "PASS" : "FAIL"}: ${v.check}`);
      out.push("");
    }
  }
  return `${out.join("\n")}\n`;
}
