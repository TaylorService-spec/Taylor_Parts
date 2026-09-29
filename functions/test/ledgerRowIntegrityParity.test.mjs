// DQ-027: the client's ledger-row readability (field-ops-app-vite/src/domain/ledgerRowIntegrity.js) must give
// the SAME verdict as the server's strict stored-record reader, row for row, over a shared matrix of
// well-formed and deliberately broken rows. Pure: no Firebase app.
import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = await import(pathToFileURL(path.join(here, "..", "..", "field-ops-app-vite", "src", "domain", "ledgerRowIntegrity.js")).href);
const { classifyLedgerDoc, deserializeOperationalMovement, serializeOperationalMovement, fingerprintMovement } =
  await import("../lib/inventoryLedger/operationalMovementRepository.js");

function serverVerdict(data) {
  const cls = classifyLedgerDoc(data);
  if (cls === "legacy") return "legacy";
  if (cls !== "operational") return "unreadable";
  try { deserializeOperationalMovement(data); return "operational"; } catch { return "unreadable"; }
}
/** The same row as the CLIENT SDK hands it over: a Timestamp is an object with toMillis(). */
function asClientRow(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  // Exactly as services/operationsQueries.ts listCollection hands a row over: the document id merged in.
  const out = { id: "doc-id" };
  for (const [k, v] of Object.entries(data)) out[k] = v instanceof Timestamp ? { toMillis: () => v.toMillis() } : v;
  return out;
}

let n = 0;
function stored(over = {}, type = "RECEIVED") {
  n += 1;
  const dir = { RECEIVED: "IN", TRANSFER_OUT: "OUT", ADJUSTED: "SIGNED", WORK_ORDER_CONSUMPTION: "SIGNED", RELOCATION_IN: "IN" }[type];
  const src = { RECEIVED: "RECEIVING_ORDER", TRANSFER_OUT: "TRANSFER_ORDER", ADJUSTED: "ADJUSTMENT", WORK_ORDER_CONSUMPTION: "WORK_ORDER", RELOCATION_IN: "STOCK_RELOCATION" }[type];
  const value = {
    type, direction: dir, partId: "P-1", trackingMode: "NONE", location: { type: "WAREHOUSE", locationId: "wh-1" },
    quantity: type === "ADJUSTED" || type === "WORK_ORDER_CONSUMPTION" ? -2 : 2,
    sourceObject: { type: src, id: `s${n}` }, idempotencyKey: `k${n}`, actor: { kind: "USER", id: "u1" }, occurredAt: 1_700_000_000_000,
    ...(type === "TRANSFER_OUT" || type === "RELOCATION_IN" ? { counterpartyLocation: { type: "BIN", locationId: "bin-9" } } : {}),
  };
  return { ...serializeOperationalMovement(value, new Date(1_700_000_000_000), fingerprintMovement(value)), ...over };
}
const del = (row, key) => { const c = { ...row }; delete c[key]; return c; };

const MATRIX = [
  ["good RECEIVED", stored()],
  ["good TRANSFER_OUT", stored({}, "TRANSFER_OUT")],
  ["good ADJUSTED signed", stored({}, "ADJUSTED")],
  ["good consumption", stored({}, "WORK_ORDER_CONSUMPTION")],
  ["good relocation in", stored({}, "RELOCATION_IN")],
  ["good with scalar owner", stored({ operatingCompanyId: "taylor" })],
  ["good transfer with pair", stored({ sourceOperatingCompanyId: "taylor", destinationOperatingCompanyId: "ventana" }, "TRANSFER_OUT")],
  ["good SERIAL", stored({ trackingMode: "SERIAL", quantity: 1, serialNo: "SN-1" })],
  ["legacy RESERVED", { type: "RESERVED", partId: "P-1", quantity: 3, workOrderId: "wo" }],
  ["legacy CONSUMED no partId", { type: "CONSUMED", quantity: 3 }],
  ["no schemaVersion RECEIVED", del(stored(), "schemaVersion")],
  ["schemaVersion 3", stored({ schemaVersion: 3 })],
  ["retired COUNTED", stored({ type: "COUNTED" })],
  ["unknown field", stored({ extra: 1 })],
  ["direction wrong", stored({ direction: "OUT" })],
  ["blank partId", stored({ partId: " " })],
  ["location extra key", stored({ location: { type: "WAREHOUSE", locationId: "w", x: 1 } })],
  ["location bad type", stored({ location: { type: "SHELF", locationId: "w" } })],
  ["quantity string", stored({ quantity: "2" })],
  ["quantity negative on IN", stored({ quantity: -2 })],
  ["quantity zero on SIGNED", stored({ quantity: 0 }, "ADJUSTED")],
  ["SERIAL qty 2", stored({ trackingMode: "SERIAL", quantity: 2, serialNo: "SN" })],
  ["SERIAL no serial", stored({ trackingMode: "SERIAL", quantity: 1 })],
  ["LOT no lotId", stored({ trackingMode: "LOT" })],
  ["bad tracking", stored({ trackingMode: "BATCH" })],
  ["source wrong type", stored({ sourceObject: { type: "SCRAP", id: "x" } })],
  ["source extra key", stored({ sourceObject: { type: "RECEIVING_ORDER", id: "x", y: 1 } })],
  ["blank idempotency", stored({ idempotencyKey: "" })],
  ["actor bad kind", stored({ actor: { kind: "BOT", id: "x" } })],
  ["SYSTEM actor not allowed", stored({ actor: { kind: "SYSTEM", id: "cron" } })],
  ["occurredAt float", stored({ occurredAt: 1.5 })],
  ["occurredAt zero", stored({ occurredAt: 0 })],
  ["recordedAt millis not Timestamp", stored({ recordedAt: 1_700_000_000_000 })],
  ["fingerprint short", stored({ fingerprint: "abc" })],
  ["transfer no counterparty", del(stored({}, "TRANSFER_OUT"), "counterpartyLocation")],
  ["transfer same ends", stored({ counterpartyLocation: { type: "WAREHOUSE", locationId: "wh-1" } }, "TRANSFER_OUT")],
  ["non-transfer with counterparty", stored({ counterpartyLocation: { type: "BIN", locationId: "b" } })],
  ["half pair", stored({ sourceOperatingCompanyId: "taylor" }, "TRANSFER_OUT")],
  ["scalar and pair", stored({ operatingCompanyId: "taylor", sourceOperatingCompanyId: "taylor", destinationOperatingCompanyId: "taylor" }, "TRANSFER_OUT")],
  ["bad company shape", stored({ operatingCompanyId: "Taylor Inc" })],
  ["pair on non-transfer", stored({ sourceOperatingCompanyId: "taylor", destinationOperatingCompanyId: "taylor" })],
  ["null", null],
  ["array", [1, 2]],
  ["string", "row"],
];

test("client and server agree on EVERY row of the matrix", () => {
  const disagreements = [];
  for (const [name, row] of MATRIX) {
    const s = serverVerdict(row);
    const c = client.classifyLedgerRow(asClientRow(row));
    if (s !== c) disagreements.push(`${name}: server=${s} client=${c}`);
  }
  assert.deepEqual(disagreements, []);
  // And the matrix is not vacuous: all three verdicts occur.
  const verdicts = new Set(MATRIX.map(([, r]) => serverVerdict(r)));
  assert.deepEqual([...verdicts].sort(), ["legacy", "operational", "unreadable"]);
});
