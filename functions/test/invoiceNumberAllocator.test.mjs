// INV-YYYY-###### allocator (Owner ruling 4, preparation only): format, parse, year and the not-wired fence, offline.
// The PostgreSQL behaviour (serialization, rollback, per-company scope, legacy coexistence) is
// invoiceNumberAllocatorPostgres.test.mjs. Prerequisite: `npm run build` in functions/ (imports lib/).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const a = require("../lib/eosFinance/invoiceNumberAllocator.js");

test("format: INV-<UTC year>-<six digits minimum>; a seventh digit appears instead of wrapping", () => {
  assert.equal(a.formatInvoiceNumber(2026, 1), "INV-2026-000001");
  assert.equal(a.formatInvoiceNumber(2026, 999999), "INV-2026-999999");
  assert.equal(a.formatInvoiceNumber(2026, 1000000), "INV-2026-1000000");
  for (const [y, s] of [[26, 1], [2026, 0], [2026, -1], [2026, 1.5], [10000, 1]]) {
    assert.throws(() => a.formatInvoiceNumber(y, s), a.InvoiceNumberError, `${y}/${s}`);
  }
});

test("year: the UTC calendar year of the issuance instant (Dec 31 after 17:00 Phoenix is already the next year)", () => {
  assert.equal(a.invoiceNumberYear(new Date("2026-12-31T23:59:59.999Z")), 2026);
  assert.equal(a.invoiceNumberYear(new Date("2027-01-01T00:00:00.000Z")), 2027);
  assert.equal(a.invoiceNumberYear(new Date("2027-01-01T00:30:00-07:00")), 2027);
  assert.equal(a.invoiceNumberYear(new Date("2026-12-31T17:30:00-07:00")), 2027, "Phoenix 17:30 on Dec 31 is 00:30 UTC Jan 1");
  assert.throws(() => a.invoiceNumberYear(new Date("nope")), a.InvoiceNumberError);
});

test("parse: the yearly and the legacy form are read; nothing else is guessed at", () => {
  assert.deepEqual({ ...a.parseInvoiceNumber("INV-2026-000042") }, { format: "YEARLY", year: 2026, sequence: 42 });
  assert.deepEqual({ ...a.parseInvoiceNumber("INV-000001") }, { format: "LEGACY", sequence: 1 }, "issued Firebase numbers stay readable");
  for (const bad of ["INV-26-1", "INV-2026-00001", "inv-2026-000001", "SO-2026-000001", "INV-2026-000001x", "", null, 7]) {
    assert.equal(a.parseInvoiceNumber(bad), null, String(bad));
  }
  assert.ok(a.INVOICE_NUMBER_PATTERN.test(a.formatInvoiceNumber(2026, 7)), "the allocator only ever produces the CHECK's form");
  assert.equal(a.LEGACY_INVOICE_NUMBER_PATTERN.test(a.formatInvoiceNumber(2026, 7)), false, "the two forms cannot collide");
});

test("the counter is keyed exactly like the invoice uniqueness constraint: (tenant, operating-company key, year)", () => {
  assert.match(a.INVOICE_NUMBER_COUNTERS_DDL, /PRIMARY KEY \(tenant_id, operating_company_key, year\)/);
  const mig = readFileSync(new URL("../migrations/1758931200000_invoice-authority.sql", import.meta.url), "utf8");
  assert.match(mig, /UNIQUE \(tenant_id, operating_company_key, invoice_number\)/, "the per-company invoice constraint the counter mirrors");
});

test("NOT WIRED: no source module imports the allocator, and no migration creates its counter yet (activation is a separate ruling)", () => {
  const src = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const importers = walk(src).filter((p) => /\.ts$/.test(p) && !p.endsWith("invoiceNumberAllocator.ts"))
    .filter((p) => /invoiceNumberAllocator/.test(readFileSync(p, "utf8")));
  assert.deepEqual(importers, []);
  const migs = readdirSync(new URL("../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql"))
    .filter((f) => /invoice_number_counters/.test(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8")));
  assert.deepEqual(migs, [], "the counter table arrives with the activation migration, not before");
});
