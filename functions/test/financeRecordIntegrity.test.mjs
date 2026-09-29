// DQ-019 — finance record integrity + the pre-activation census.
// Run: node --test test/financeRecordIntegrity.test.mjs   (after `npm run build`)
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const { financeRecordDefects, censusFinanceRecords, FINANCE_RECORD_SHAPES } = await import("../lib/finance/financeRecordIntegrity.js");
const { readAccountInvoiceAr } = await import("../lib/finance/financeReadCallables.js");

const INVOICE = { totalMinor: 1000, currency: "USD", appliedMinor: 0 };
const RECEIPT = { amountMinor: 1000, appliedMinor: 1000, currency: "USD" };
const APPLICATION = { invoiceId: "i1", paymentId: "p1", appliedAmountMinor: 1000, currency: "USD" };

test("the shapes are the governed writers' shapes, nothing stricter", () => {
  assert.deepEqual([...FINANCE_RECORD_SHAPES.INVOICE.requiredMoney], ["totalMinor"]);
  assert.deepEqual([...FINANCE_RECORD_SHAPES.INVOICE.optionalMoney], ["appliedMinor", "creditsMinor", "chargesMinor", "writeOffMinor"]);
  assert.deepEqual(financeRecordDefects("INVOICE", INVOICE), []);
  assert.deepEqual(financeRecordDefects("PAYMENT_RECEIPT", RECEIPT), []);
  assert.deepEqual(financeRecordDefects("PAYMENT_APPLICATION", APPLICATION), []);
});

test("money must be a safe non-negative integer in minor units: strings, negatives, fractions, NaN, null are malformed", () => {
  for (const bad of ["1000", -1, 10.5, Number.NaN, null, Number.MAX_SAFE_INTEGER + 2, {}]) {
    assert.deepEqual(financeRecordDefects("INVOICE", { ...INVOICE, totalMinor: bad }), ["totalMinor"], String(bad));
    assert.deepEqual(financeRecordDefects("INVOICE", { ...INVOICE, appliedMinor: bad }), ["appliedMinor"], String(bad));
  }
});

test("an absent OPTIONAL counter is valid (the writers' zero); an absent REQUIRED field is not", () => {
  assert.deepEqual(financeRecordDefects("INVOICE", { totalMinor: 5, currency: "USD" }), []);
  assert.deepEqual(financeRecordDefects("INVOICE", { currency: "USD" }), ["totalMinor"]);
  assert.deepEqual(financeRecordDefects("PAYMENT_RECEIPT", { amountMinor: 5, currency: "USD" }), ["appliedMinor"]);
  assert.deepEqual(financeRecordDefects("PAYMENT_APPLICATION", { appliedAmountMinor: 5, currency: "USD", invoiceId: "i" }), ["paymentId"]);
  assert.deepEqual(financeRecordDefects("INVOICE", null), ["<record>"]);
});

test("the census: CLEAN over sound records; MALFORMED_PRESENT lists id + FIELD NAMES only, never values", () => {
  const clean = censusFinanceRecords({ invoices: [{ id: "i1", data: INVOICE }], payments: [{ id: "p1", data: RECEIPT }], payment_applications: [{ id: "a1", data: APPLICATION }] });
  assert.equal(clean.verdict, "CLEAN");
  assert.deepEqual(clean.scanned, { INVOICE: 1, PAYMENT_RECEIPT: 1, PAYMENT_APPLICATION: 1 });

  const secretish = "password: hunter2";
  const dirty = censusFinanceRecords({
    invoices: [{ id: "i2", data: { ...INVOICE, appliedMinor: secretish } }, { id: "i1", data: INVOICE }],
    payment_applications: [{ id: "a9", data: { ...APPLICATION, paymentId: "" } }],
    payments: [{ id: "", data: RECEIPT }],
  });
  assert.equal(dirty.verdict, "MALFORMED_PRESENT");
  assert.deepEqual(dirty.malformed, { INVOICE: 1, PAYMENT_RECEIPT: 1, PAYMENT_APPLICATION: 1 });
  assert.deepEqual(dirty.byField.INVOICE, { appliedMinor: 1 });
  assert.deepEqual(dirty.findings.map((f) => [f.kind, f.id, f.fields]), [
    ["INVOICE", "i2", ["appliedMinor"]],
    ["PAYMENT_APPLICATION", "a9", ["paymentId"]],
    ["PAYMENT_RECEIPT", "<no id>", ["<id>"]],
  ]);
  assert.ok(!JSON.stringify(dirty).includes("hunter2"), "a census never carries a stored value");
});

test("the census refuses a non-array collection rather than scanning nothing", () => {
  assert.throws(() => censusFinanceRecords({ invoices: { i1: INVOICE } }), /must be an array/);
});

test("the census and the integrity module repair nothing: no write, no Firebase, no I/O", () => {
  const src = readFileSync(new URL("../src/finance/financeRecordIntegrity.ts", import.meta.url), "utf8");
  for (const banned of [/from\s+["']firebase/, /getFirestore/, /\.set\(|\.update\(|\.add\(|\.delete\(/, /from\s+["']node:fs["']/, /from\s+["']pg["']/]) {
    assert.ok(!banned.test(src), `financeRecordIntegrity.ts must stay pure: ${banned}`);
  }
});

// ── listAccountInvoiceAr's core: a visible malformed invoice makes the account's AR UNAVAILABLE ──
const fakeAccountDb = (rows) => {
  const q = (r) => ({ where: (f, _o, v) => q(r.filter((x) => x.data[f] === v)), limit: (n) => q(r.slice(0, n)), async get() { return { size: r.length, docs: r.map((x) => ({ id: x.id, data: () => x.data })) }; } });
  return { collection: () => q(rows) };
};

test("account AR: a visible invoice with unreadable money is UNAVAILABLE, never 'nothing owed'", async () => {
  const rows = [
    { id: "ok", data: { ...INVOICE, accountId: "a1", companyId: "taylor" } },
    { id: "bad", data: { ...INVOICE, accountId: "a1", companyId: "taylor", appliedMinor: "1000" } },
  ];
  const r = await readAccountInvoiceAr(fakeAccountDb(rows), "a1", 50, () => true);
  assert.equal(r.status, "unavailable");
  assert.deepEqual(r.invoices, []);
  const hidden = await readAccountInvoiceAr(fakeAccountDb(rows), "a1", 50, (f) => f.companyId !== "taylor");
  assert.equal(hidden.status, "ready", "a malformed invoice outside reach neither blocks nor discloses");
  const clean = await readAccountInvoiceAr(fakeAccountDb([rows[0]]), "a1", 50, () => true);
  assert.equal(clean.status, "ready");
  assert.equal(clean.invoices.length, 1);
});

// ── The operator CLI over an exported snapshot: no database, no Firebase, evidence never overwritten ──
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = new URL("../scripts/financeRecordCensusCli.js", import.meta.url).pathname;
const runCli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname });

test("CLI: CLEAN exits 0, MALFORMED_PRESENT exits 1, refusals exit 2; evidence is exclusive and value-free", () => {
  const dir = mkdtempSync(join(tmpdir(), "fin-census-"));
  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify({ invoices: [{ id: "i1", data: INVOICE }], payments: [], payment_applications: [] }));
  const r0 = runCli(["--snapshot", good, "--out", join(dir, "good-out.json")]);
  assert.equal(r0.status, 0, r0.stderr);
  assert.match(r0.stdout, /^CLEAN/);

  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ invoices: [{ id: "i1", data: { ...INVOICE, totalMinor: "SECRET-9" } }] }));
  const out = join(dir, "bad-out.json");
  const r1 = runCli(["--snapshot", bad, "--out", out]);
  assert.equal(r1.status, 1, r1.stderr);
  assert.ok(existsSync(`${out}.sha256`));
  assert.ok(!readFileSync(out, "utf8").includes("SECRET-9"), "evidence carries no stored value");

  const again = runCli(["--snapshot", bad, "--out", out]);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /never overwritten/);
  assert.equal(runCli(["--out", join(dir, "x.json")]).status, 2);
});

test("CLI: imports no Firebase, no pg, and writes nothing but its own evidence", () => {
  const src = readFileSync(CLI, "utf8");
  assert.ok(!/require\(["'](firebase|firebase-admin|pg)["'/]/.test(src));
  assert.ok(!/getFirestore|FIREBASE_EXIT_MIGRATION_ONLY\n/.test(src));
});
