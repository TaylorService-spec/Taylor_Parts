// CRM CUTOVER -- the offline proofs. No database, no Firebase runtime, no network.
//
//   * the snapshot exporter is the Owner's FIREBASE_EXIT_MIGRATION_ONLY exception and is held to it: marked, read-only,
//     exact collection allowlist, never overwrites, and imported by NO runtime module;
//   * the census / copy side loads no Firebase module and names no Firestore write;
//   * census logic over fixture snapshots: free-text billing address held for resolution (never parsed), unmappable
//     status blocked, dangling references, Certification fixtures excluded with evidence, Firebase uids provenance-only,
//     owners resolved against the target tenant, Commercial Account references, unclassified fields, determinism.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  FAKE_UID_A, FAKE_UID_B, accountDoc, asFile, cleanSnapshot, contactDoc, locationDoc, resolvingFacts, snapshotOf, ts,
} from "./support/crmSnapshotFixture.mjs";

const require = createRequire(import.meta.url);
const snap = require("../lib/crm/crmCutoverSnapshot.js");
const { parseCrmSnapshot, censusCrmSnapshot, finalizeCrmCensus, CrmSnapshotError } = snap;

const REPO_ROOT = resolve("..");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const walk = (dir, exts) => readdirSync(dir).flatMap((f) => {
  if (f === "node_modules" || f === "dist" || f === "lib") return [];
  const full = join(dir, f);
  return statSync(full).isDirectory() ? walk(full, exts) : exts.some((e) => f.endsWith(e)) ? [full] : [];
});

const run = (snapshot, facts = resolvingFacts()) => finalizeCrmCensus(censusCrmSnapshot(parseCrmSnapshot(asFile(snapshot))), facts);
const codes = (census, id) => census.findings.filter((f) => id === undefined || f.id === id).map((f) => f.code);

// ════════════════════ the MIGRATION-ONLY exporter ════════════════════

const EXPORTER = "scripts/exportCrmSnapshot.js";

test("the exporter carries the FIREBASE_EXIT_MIGRATION_ONLY marker as its first line", () => {
  const src = readFileSync(EXPORTER, "utf8");
  assert.equal(src.split("\n")[0], "// FIREBASE_EXIT_MIGRATION_ONLY");
  assert.match(stripComments(src), /const MIGRATION_ONLY_MARKER = "FIREBASE_EXIT_MIGRATION_ONLY";/);
});

test("the exporter reads exactly accounts, contacts, locations -- and performs only collection reads", () => {
  const { COLLECTIONS } = require("../scripts/exportCrmSnapshot.js");
  assert.deepEqual([...COLLECTIONS], ["accounts", "contacts", "locations"]);
  assert.deepEqual([...COLLECTIONS], [...snap.CRM_SNAPSHOT_COLLECTIONS]);
  const code = stripComments(readFileSync(EXPORTER, "utf8"));
  assert.doesNotMatch(code, /\.(set|add|update|delete|create|commit|batch|runTransaction|bulkWriter|recursiveDelete|listCollections|collectionGroup|onSnapshot)\s*\(/);
  assert.deepEqual([...code.matchAll(/\bdb\.(\w+)\(/g)].map((m) => m[1]), ["collection"]);
  assert.equal([...code.matchAll(/\.collection\(/g)].length, 1, "one collection read, driven by the allowlist");
  assert.match(code, /flag: "wx"/, "a snapshot is never overwritten");
  assert.equal([...code.matchAll(/flag: "wx", mode: 0o600/g)].length, 2, "snapshot and checksum are both exclusive, 0600");
  assert.doesNotMatch(code, /setInterval|setTimeout|cron|schedule|onRequest|onCall|exports\.\w+\s*=\s*functions/);
});

test("STRUCTURAL: no runtime module (functions/src, field-ops-app-vite/src, integrations) imports the exporter", () => {
  const offenders = [];
  for (const root of ["functions/src", "field-ops-app-vite/src", "integrations"]) {
    const dir = join(REPO_ROOT, root);
    for (const file of walk(dir, [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])) {
      const text = readFileSync(file, "utf8");
      const importsIt = [...text.matchAll(/\bfrom\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gm)]
        .some((m) => /exportCrmSnapshot/.test(m[1] ?? m[2] ?? m[3] ?? m[4]));
      if (importsIt) offenders.push(relative(REPO_ROOT, file).split(sep).join("/"));
    }
  }
  assert.deepEqual(offenders, []);
  // Nor any other operator script: the export is run by a person, never composed.
  const scripts = walk(resolve("scripts"), [".js", ".mjs", ".cjs"]).filter((f) => !f.endsWith("exportCrmSnapshot.js"));
  assert.deepEqual(scripts.filter((f) => /require\([^)]*exportCrmSnapshot|from\s+["'][^"']*exportCrmSnapshot/.test(readFileSync(f, "utf8"))), []);
});

test("the exporter encodes Timestamps, tags unsupported Firestore types, and refuses an ambiguous stored tag", () => {
  const { encodeValue } = require("../scripts/exportCrmSnapshot.js");
  class FakeTimestamp { constructor(s, n) { this.seconds = s; this.nanoseconds = n; } }
  class GeoPoint {}
  assert.deepEqual(encodeValue({ b: [1, "x", null], a: new FakeTimestamp(5, 7) }, FakeTimestamp, "d"), { a: { $timestamp: { seconds: 5, nanoseconds: 7 } }, b: [1, "x", null] });
  assert.deepEqual(encodeValue({ where: new GeoPoint() }, FakeTimestamp, "d"), { where: { $unsupported: "GeoPoint" } });
  assert.throws(() => encodeValue({ $timestamp: 1 }, FakeTimestamp, "d"), /ambiguous/);
  assert.throws(() => encodeValue({ nested: { $unsupported: "x" } }, FakeTimestamp, "d"), /ambiguous/);
});

// ════════════════════ no Firebase on the census / copy side ════════════════════

const FORBIDDEN = [/from\s+["']firebase/, /require\(\s*["']firebase/, /import\(\s*["']firebase/, /\bgetFirestore\s*\(/, /\bFieldValue\b/, /@google-cloud\/firestore/];
const CUTOVER_SOURCES = ["src/crm/crmCutoverSnapshot.ts", "src/crm/crmCutoverTarget.ts", "src/crm/crmCutoverCopy.ts", "src/crm/crmWriterState.ts", "src/crm/postgresCustomerImport.ts"];

test("the CRM cutover modules and the copy tool import no Firebase and name no Firestore write", () => {
  for (const file of [...CUTOVER_SOURCES, "scripts/crmCutover.js"]) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const p of FORBIDDEN) assert.doesNotMatch(code, p, `${file}: ${p}`);
    // Firestore write shapes: a verb on a db/batch/transaction/document/collection handle, or a batch/transaction factory.
    assert.doesNotMatch(code, /\b(db|batch|txn|tx|ref|doc\([^)]*\)|collection\([^)]*\))\.(set|add|update|delete|create|commit)\s*\(/, file);
    assert.doesNotMatch(code, /\b(runTransaction|bulkWriter|writeBatch)\s*\(/, file);
  }
  const code = stripComments(readFileSync("scripts/crmCutover.js", "utf8"));
  const topLevelRequires = code.split("async function main")[0].match(/require\(\s*["'][^"']+["']\s*\)/g);
  assert.deepEqual(topLevelRequires, ['require("node:fs")', 'require("node:path")', 'require("node:crypto")', 'require("./measureEmployeeReferenceIntegrity.js")', 'require("./measureWorkforceActivation.js")']);
});

test("loading the compiled CRM cutover modules never resolves a Firebase package (runtime probe)", () => {
  const dir = mkdtempSync(join(tmpdir(), "crm-cutover-probe-"));
  const preload = join(dir, "banFirebase.cjs");
  writeFileSync(preload, 'const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase|@google-cloud\\/firestore/i.test(r)){process.stderr.write("FIREBASE_LOADED:"+r);process.exit(97);}return l.call(this,r,...a);};');
  const modules = ["lib/crm/crmCutoverSnapshot.js", "lib/crm/crmCutoverTarget.js", "lib/crm/crmCutoverCopy.js", "lib/crm/crmWriterState.js", "lib/crm/postgresCustomerImport.js", "scripts/crmCutover.js"].map((m) => resolve(m));
  const probe = spawnSync(process.execPath, ["--require", preload, "-e", modules.map((m) => `require(${JSON.stringify(m)});`).join("")], { encoding: "utf8" });
  assert.equal(probe.status, 0, `a CRM cutover module transitively loaded Firebase: ${probe.stderr}`);
});

// ════════════════════ vocabulary parity ════════════════════

test("the restated Account vocabularies are the client's and firestore.rules', exactly", () => {
  const constants = readFileSync(join(REPO_ROOT, "field-ops-app-vite/src/domain/constants.js"), "utf8");
  const valuesOf = (name) => {
    const m = new RegExp(`export const ${name} = (?:Object\\.freeze\\()?\\{([^}]*)\\}`).exec(constants);
    assert.ok(m, `${name} not found`);
    return [...m[1].matchAll(/:\s*"([A-Z_0-9]+)"/g)].map((x) => x[1]);
  };
  const { CRM_ACCOUNT_STATUSES } = require("../lib/crm/customerIdentity.js");
  assert.deepEqual(valuesOf("ACCOUNT_STATUS").sort(), [...CRM_ACCOUNT_STATUSES].sort());
  assert.deepEqual(valuesOf("ACCOUNT_RELATIONSHIP_TYPE"), [...snap.ACCOUNT_RELATIONSHIP_TYPES]);
  assert.deepEqual(valuesOf("ACCOUNT_LINE_OF_BUSINESS"), [...snap.ACCOUNT_LINES_OF_BUSINESS]);
  assert.deepEqual(valuesOf("INVOICE_DELIVERY_METHOD"), [...snap.INVOICE_DELIVERY_METHODS]);
  assert.deepEqual(valuesOf("PAYMENT_TERMS"), [...snap.PAYMENT_TERMS]);
  assert.deepEqual(valuesOf("TAX_STATUS"), [...snap.TAX_STATUSES]);
  const rules = readFileSync(join(REPO_ROOT, "firestore.rules"), "utf8");
  assert.ok(rules.includes(`data.get('paymentTerms', null) in [${snap.PAYMENT_TERMS.map((v) => `'${v}'`).join(", ")}]`));
  assert.ok(rules.includes(`data.get('taxStatus', null) in [${snap.TAX_STATUSES.map((v) => `'${v}'`).join(", ")}]`));
});

// ════════════════════ snapshot parse ════════════════════

test("the snapshot parser refuses a foreign format, a collection outside the allowlist, and a malformed document", () => {
  assert.throws(() => parseCrmSnapshot({ format: "EOS_CATALOG_SNAPSHOT", version: 1 }), CrmSnapshotError);
  assert.throws(() => parseCrmSnapshot({ ...asFile(cleanSnapshot()), employees: [] }), /outside the allowlist: employees/);
  assert.throws(() => parseCrmSnapshot({ ...asFile(cleanSnapshot()), contacts: [{ id: "x" }] }), /exactly \{ id, data \}/);
  assert.throws(() => parseCrmSnapshot({ ...asFile(cleanSnapshot()), source: { firebaseProjectId: "p", exportedAt: "2026-01-01T00:00:00Z" } }), /environmentId/);
});

// ════════════════════ census: the clean world ════════════════════

test("a clean snapshot is NOT copy-ready until owners are measured, then is, with exact canonical records", () => {
  const unmeasured = censusCrmSnapshot(parseCrmSnapshot(asFile(cleanSnapshot())));
  assert.equal(unmeasured.census.copyReady, false);
  assert.deepEqual(unmeasured.census.blockers, ["OWNER_RESOLUTION_NOT_MEASURED"]);

  const { census, crm, evidence } = run(cleanSnapshot());
  assert.equal(census.copyReady, true, JSON.stringify(census.findings.filter((f) => f.severity === "BLOCKING")));
  assert.deepEqual(census.counts, { accounts: 3, contacts: 2, locations: 2 });
  assert.deepEqual(census.selected, { accounts: 3, contacts: 2, locations: 2 });
  assert.deepEqual(census.ownerless, { accounts: 1, contacts: 0, locations: 0 }, "a legacy ownerless Account is carried; no child is ownerless");
  assert.deepEqual(census.ownerReferences, { "emp-owner-1": 4, "emp-owner-2": 2 });
  assert.deepEqual(census.statusDistribution, { ACTIVE: 2, PROSPECT: 1 });
  assert.deepEqual(census.addressShapes, { nested: 1, flat: 1, both: 0, absent: 0 });
  assert.deepEqual(census.timestampShapes.accounts.createdAt, { TIMESTAMP: 3, EPOCH_MILLIS: 0, ABSENT: 0, INVALID: 0 });
  assert.deepEqual(census.timestampShapes.contacts.createdAt, { TIMESTAMP: 0, EPOCH_MILLIS: 2, ABSENT: 0, INVALID: 0 });

  const alpha = crm.accounts.find((a) => a.id === "acct-alpha");
  assert.deepEqual(alpha, {
    id: "acct-alpha", name: "Fixture Customer acct-alpha", status: "ACTIVE", ownerEmployeeId: "emp-owner-1", notes: null,
    billingAddressStreet: "1 Fixture Way", billingAddressCity: "Testville", billingAddressState: "AZ", billingAddressPostalCode: "85001",
    customerNumber: null, erpId: null, accountingId: null, legacyId: null, defaultCurrency: "USD", purchaseOrderRequired: false,
    invoiceDeliveryMethod: "EMAIL", paymentTerms: "NET_30", taxStatus: "TAXABLE", billingContactId: "con-alpha-ap", tags: ["fixture"],
    relationshipTypes: ["CUSTOMER"], linesOfBusiness: ["TAYLOR"], createdAt: "2025-01-02T03:04:05.678000Z", updatedAt: "2025-06-07T08:09:10.111000Z",
  });
  assert.equal(crm.accounts.find((a) => a.id === "acct-ownerless").ownerEmployeeId, null, "a legacy OWNERLESS Account is carried, never filled in");
  const bravo = crm.accounts.find((a) => a.id === "acct-bravo");
  assert.deepEqual([bravo.relationshipTypes, bravo.linesOfBusiness], [["CUSTOMER", "VENDOR"], ["TAYLOR", "VENTANA"]], "sets in vocabulary order");
  const flat = crm.locations.find((l) => l.id === "loc-bravo-flat");
  assert.deepEqual([flat.addressStreet, flat.addressCity, flat.addressState, flat.addressPostalCode], ["5 Flat St", "Flatland", "NM", null]);
  assert.equal(flat.ownerEmployeeId, "emp-owner-1", "an independently stated site owner is kept");
  const contact = crm.contacts.find((c) => c.id === "con-bravo-1");
  assert.equal(contact.ownerEmployeeId, "emp-owner-2", "no stated owner: follows its Account's owner at cutover (ruling 4)");
  assert.equal(contact.createdAt, "2025-01-02T03:04:05.678000Z");
  assert.deepEqual(evidence.ownerDerivations, [{ collection: "contacts", id: "con-bravo-1", derivedFromAccountId: "acct-bravo", ownerEmployeeId: "emp-owner-2", rule: "D1_CREATION_OWNER_FOLLOWS_ACCOUNT_OWNER_AT_CUTOVER" }]);
});

test("the census and digest are deterministic: document order in the file does not matter", () => {
  const a = asFile(cleanSnapshot());
  const b = asFile(cleanSnapshot());
  for (const k of ["accounts", "contacts", "locations"]) b[k].reverse();
  assert.equal(run(a).census.canonicalDigest, run(b).census.canonicalDigest);
  assert.deepEqual(run(a).census.findings, run(b).census.findings);
  const c = asFile(cleanSnapshot());
  c.accounts[0].data.notes = "changed";
  assert.notEqual(run(c).census.canonicalDigest, run(a).census.canonicalDigest);
});

// ════════════════════ billing address ════════════════════

test("BILLING ADDRESS: a single free-text value is never parsed -- held in evidence, Account blocked for resolution", () => {
  const s = cleanSnapshot();
  s.accounts[1].data.billingAddress = "12 Main St, Springfield, IL 62701";
  const { census, crm, evidence } = run(s);
  assert.equal(census.copyReady, false);
  assert.ok(census.blockers.includes("BILLING_ADDRESS_REQUIRES_RESOLUTION"));
  assert.deepEqual(evidence.billingAddressResolution, [{ accountId: "acct-bravo", freeText: "12 Main St, Springfield, IL 62701" }]);
  assert.equal(crm.accounts.find((a) => a.id === "acct-bravo"), undefined, "the Account is not selected with a guessed or dropped address");
  const serialized = JSON.stringify(crm);
  for (const fragment of ["12 Main St", "Springfield", "62701"]) assert.ok(!serialized.includes(fragment), `free text reached a canonical column: ${fragment}`);
  assert.deepEqual(census.billingAddressShapes, { structured: 2, freeText: 1, absent: 0, invalid: 0 });
});

test("BILLING ADDRESS: structured parts map directly; blank parts are NULL; an unknown part blocks", () => {
  const s = cleanSnapshot();
  s.accounts[0].data.billingAddress = { street: " 1 Fixture Way ", city: "", state: "AZ", zip: "" };
  const { crm } = run(s);
  const a = crm.accounts.find((x) => x.id === "acct-alpha");
  assert.deepEqual([a.billingAddressStreet, a.billingAddressCity, a.billingAddressState, a.billingAddressPostalCode], ["1 Fixture Way", null, "AZ", null]);
  s.accounts[0].data.billingAddress = { street: "1 Fixture Way", line2: "Suite 4" };
  assert.ok(codes(run(s).census, "acct-alpha").includes("FIELD_VALUE_INVALID"));
});

// ════════════════════ status ════════════════════

test("STATUS: title-cased, unknown and absent statuses are unmappable blockers -- never case-folded or defaulted", () => {
  const s = cleanSnapshot();
  s.accounts.push(accountDoc("acct-title", { status: "Active" }), accountDoc("acct-dormant", { status: "DORMANT" }), accountDoc("acct-nostatus", { status: undefined }));
  const { census, crm } = run(s);
  for (const id of ["acct-title", "acct-dormant", "acct-nostatus"]) {
    assert.ok(codes(census, id).includes("STATUS_UNMAPPABLE"), id);
    assert.equal(crm.accounts.find((a) => a.id === id), undefined);
  }
  assert.deepEqual(census.statusDistribution, { "<absent>": 1, ACTIVE: 2, Active: 1, DORMANT: 1, PROSPECT: 1 });
});

// ════════════════════ references ════════════════════

test("DANGLING: a Contact or site naming an absent Account, or none, blocks; the parent is never guessed", () => {
  const s = cleanSnapshot();
  s.contacts.push(contactDoc("con-orphan", "acct-missing"), contactDoc("con-noparent", undefined));
  s.locations.push(locationDoc("loc-orphan", "acct-missing"));
  const { census, crm } = run(s);
  assert.ok(codes(census, "con-orphan").includes("ACCOUNT_REFERENCE_DANGLING"));
  assert.ok(codes(census, "con-noparent").includes("ACCOUNT_ID_MISSING"));
  assert.ok(codes(census, "loc-orphan").includes("ACCOUNT_REFERENCE_DANGLING"));
  assert.equal(crm.contacts.length, 2);
  assert.equal(crm.locations.length, 2);
});

test("BILLING CONTACT: a billing Contact of another Account blocks the Account", () => {
  const s = cleanSnapshot();
  s.accounts[0].data.billingContact = { contactId: "con-bravo-1" };
  const { census } = run(s);
  assert.ok(codes(census, "acct-alpha").includes("BILLING_CONTACT_NOT_ON_ACCOUNT"));
});

// ════════════════════ Certification world ════════════════════

test("CERTIFICATION: marked fixtures are excluded with ids and reason; their children dangle; an unmarked cw- id blocks", () => {
  const s = cleanSnapshot();
  const marker = { version: "v9", datasetId: "cert" };
  s.accounts.push(accountDoc("cw-acct-000", { certificationWorld: marker, category: "Restaurant", city: "Phoenix" }));
  s.locations.push(locationDoc("cw-acct-000-loc-00", "cw-acct-000", { certificationWorld: marker, fieldProvenance: {} }));
  s.contacts.push(contactDoc("con-under-cert", "cw-acct-000"));
  s.accounts.push(accountDoc("cw-acct-001"));
  // The MARKER identifies a fixture, not the id prefix: a marked record with an ordinary id is excluded too.
  s.accounts.push(accountDoc("acct-marked-fixture", { certificationWorld: marker }));
  const { census, crm, evidence } = run(s);
  assert.deepEqual(census.certificationExcluded, { accounts: 2, contacts: 0, locations: 1 });
  assert.deepEqual(evidence.certificationExcluded.map((e) => `${e.collection}/${e.id}`), ["accounts/acct-marked-fixture", "accounts/cw-acct-000", "locations/cw-acct-000-loc-00"]);
  assert.equal(crm.accounts.find((a) => a.id === "acct-marked-fixture"), undefined);
  assert.match(evidence.certificationExcluded[0].reason, /Certification-world fixture/);
  assert.ok(!JSON.stringify(crm).includes("cw-acct-000"), "a Certification fixture reached the copy");
  assert.ok(codes(census, "con-under-cert").includes("ACCOUNT_REFERENCE_DANGLING"));
  assert.ok(codes(census, "cw-acct-001").includes("CERTIFICATION_ID_WITHOUT_MARKER"));
});

// ════════════════════ identity and provenance ════════════════════

test("UID PROVENANCE: Firebase uids and the owner-assignment trail reach the evidence, never a canonical record", () => {
  const { crm, evidence } = run(cleanSnapshot());
  const serialized = JSON.stringify(crm);
  for (const leaked of [FAKE_UID_A, FAKE_UID_B, "emp-manager-1", "Owner Snapshot Name", "Manager Snapshot Name", "1756000000000"]) {
    assert.ok(!serialized.includes(leaked), `provenance leaked into canonical records: ${leaked}`);
  }
  const alpha = evidence.provenance.find((p) => p.id === "acct-alpha");
  assert.deepEqual(alpha.ownerAssignment, {
    assignedToUserId: FAKE_UID_A, assignedToDisplayName: "Owner Snapshot Name", assignedByEmployeeId: "emp-manager-1",
    assignedByUserId: FAKE_UID_B, assignedByDisplayName: "Manager Snapshot Name", assignedAt: 1_756_000_000_000,
  });
  const contact = evidence.provenance.find((p) => p.id === "con-alpha-ap");
  assert.deepEqual([contact.createdBy, contact.updatedBy], [FAKE_UID_A, FAKE_UID_B]);
  for (const r of [...crm.accounts, ...crm.contacts, ...crm.locations]) {
    assert.deepEqual(Object.keys(r).filter((k) => /created_?by|updated_?by|uid|principal/i.test(k)), [], "no actor field on a canonical record");
  }
});

test("OWNER: an owner that does not resolve to a same-tenant Employee blocks; it is never nulled", () => {
  const { census, crm } = run(cleanSnapshot(), resolvingFacts(["emp-owner-2"]));
  assert.equal(census.copyReady, false);
  assert.deepEqual(new Set(census.findings.filter((f) => f.code === "OWNER_UNRESOLVED").map((f) => f.id)), new Set(["acct-alpha", "con-alpha-ap", "loc-alpha-main", "loc-bravo-flat"]));
  assert.equal(crm.accounts.find((a) => a.id === "acct-alpha").ownerEmployeeId, "emp-owner-1");
});

test("RULING 4: a child with no stated owner follows its OWN Account's owner, with evidence; under an ownerless Account it is blocked", () => {
  const s = cleanSnapshot();
  s.contacts.push(contactDoc("con-under-ownerless", "acct-ownerless", { owner: undefined }));
  s.locations.push(locationDoc("loc-under-ownerless", "acct-ownerless", { owner: undefined }), locationDoc("loc-alpha-derived", "acct-alpha", { owner: undefined }));
  const { census, crm, evidence } = run(s);
  assert.deepEqual(census.findings.filter((f) => f.code === "CHILD_OWNER_UNDERIVABLE").map((f) => f.id).sort(), ["con-under-ownerless", "loc-under-ownerless"]);
  assert.ok(census.blockers.includes("CHILD_OWNER_UNDERIVABLE"));
  for (const id of ["con-under-ownerless", "loc-under-ownerless"]) assert.ok(![...crm.contacts, ...crm.locations].some((r) => r.id === id), `${id} was copied ownerless`);
  assert.ok(![...crm.contacts, ...crm.locations].some((r) => r.ownerEmployeeId === null), "a governed child is never ownerless");
  // Every derived child has exactly one evidence entry, naming ITS Account and that Account's owner.
  const derivedIds = evidence.ownerDerivations.map((d) => `${d.collection}/${d.id}`);
  assert.deepEqual(derivedIds, ["contacts/con-bravo-1", "locations/loc-alpha-derived"]);
  const accountOwner = new Map(crm.accounts.map((a) => [a.id, a.ownerEmployeeId]));
  for (const d of evidence.ownerDerivations) {
    const child = (d.collection === "contacts" ? crm.contacts : crm.locations).find((r) => r.id === d.id);
    assert.equal(child.accountId, d.derivedFromAccountId);
    assert.equal(d.ownerEmployeeId, accountOwner.get(child.accountId));
    assert.equal(child.ownerEmployeeId, d.ownerEmployeeId);
  }
  // No child owner exists that is neither stated in the source nor evidenced.
  const statedChild = new Set([...s.contacts, ...s.locations].filter((d) => d.data.owner).map((d) => d.id));
  for (const r of [...crm.contacts, ...crm.locations]) assert.ok(statedChild.has(r.id) || derivedIds.some((x) => x.endsWith(`/${r.id}`)), `${r.id} has an owner without evidence`);
  const { ownerDerivationInconsistencies } = require("../lib/crm/crmCutoverCopy.js");
  assert.deepEqual(ownerDerivationInconsistencies(crm, evidence.ownerDerivations), []);
  const wrong = evidence.ownerDerivations.map((d) => (d.id === "con-bravo-1" ? { ...d, derivedFromAccountId: "acct-alpha", ownerEmployeeId: "emp-owner-1" } : d));
  assert.deepEqual(ownerDerivationInconsistencies(crm, wrong).map((x) => x.reason), ["DERIVED_FROM_ANOTHER_ACCOUNT"]);
});

test("OWNER: an unrecognised accountOwner or typed owner shape blocks", () => {
  const s = cleanSnapshot();
  s.accounts[0].data.accountOwner = { employeeId: "emp-owner-1" };
  s.contacts[0].data.owner = { type: "TEAM", id: "t1" };
  const { census } = run(s);
  assert.ok(codes(census, "acct-alpha").includes("OWNER_SHAPE_UNRECOGNISED"));
  assert.ok(codes(census, "con-alpha-ap").includes("OWNER_SHAPE_UNRECOGNISED"));
});

test("COMMERCIAL: a Commercial row naming an Account the copy will not provide blocks; an existing target Account satisfies it", () => {
  const facts = { ...resolvingFacts(), commercialAccountIds: [{ table: "eos_commercial.opportunities", accountId: "acct-gone" }, { table: "eos_commercial.sales_orders", accountId: "acct-alpha" }, { table: "eos_commercial.opportunities", accountId: "synthetic-np-acct-retail" }], existingAccountIds: new Set(["synthetic-np-acct-retail"]) };
  const { census } = run(cleanSnapshot(), facts);
  assert.deepEqual(census.findings.filter((f) => f.code === "COMMERCIAL_ACCOUNT_REFERENCE_UNRESOLVABLE").map((f) => f.id), ["acct-gone"]);
});

// ════════════════════ shapes that have no canonical target ════════════════════

test("LOCATION TYPE: a customer site carrying type / locationType blocks (the CRM site namespace has no type)", () => {
  const s = cleanSnapshot();
  s.locations[0].data.type = "WAREHOUSE";
  s.locations[1].data.locationType = "CUSTOMER";
  const { census, crm } = run(s);
  assert.ok(codes(census, "loc-alpha-main").includes("FIELD_HAS_NO_CANONICAL_TARGET"));
  assert.ok(codes(census, "loc-bravo-flat").includes("FIELD_HAS_NO_CANONICAL_TARGET"));
  assert.equal(crm.locations.length, 0);
});

test("ADDRESS SHAPES: nested and flat that agree merge; that disagree block with no precedence chosen", () => {
  const s = cleanSnapshot();
  s.locations[0].data.city = "Testville";
  assert.equal(run(s).census.addressShapes.both, 1);
  assert.ok(!codes(run(s).census, "loc-alpha-main").includes("ADDRESS_SHAPE_CONFLICT"));
  s.locations[0].data.city = "Elsewhere";
  assert.ok(codes(run(s).census, "loc-alpha-main").includes("ADDRESS_SHAPE_CONFLICT"));
});

test("RULING 3: title maps to contact_role (conflict blocks); scalar lineOfBusiness is a one-item set; obsolete fields go to evidence", () => {
  const s = cleanSnapshot();
  s.accounts[0].data.favouriteColour = "blue";
  s.accounts[1].data.lineOfBusiness = "VENTANA";
  s.accounts[2].data.city = "Phoenix";
  s.accounts[2].data.phone = "602-555-0000";
  s.accounts[2].data.website = "https://acme-website.example";
  s.contacts[1].data.title = "General Manager";
  s.contacts[1].data.locationId = "loc-bravo-flat";
  s.locations[0].data.locationId = "not-the-id";
  const { census, crm, evidence } = run(s);
  assert.ok(codes(census, "acct-alpha").includes("UNCLASSIFIED_SOURCE_FIELD"), "an unknown field still blocks");
  assert.ok(codes(census, "loc-alpha-main").includes("IDENTITY_ECHO_MISMATCH"));
  assert.deepEqual(crm.accounts.find((a) => a.id === "acct-bravo").linesOfBusiness, ["VENTANA"]);
  assert.equal(crm.contacts.find((c) => c.id === "con-bravo-1").contactRole, "General Manager");
  const ownerless = crm.accounts.find((a) => a.id === "acct-ownerless");
  assert.deepEqual([ownerless.billingAddressCity, ownerless.billingAddressStreet], ["Testville", "1 Fixture Way"], "Account city is never promoted to a billing address");
  assert.deepEqual(evidence.notMigratedValues.map((v) => `${v.collection}/${v.id}.${v.field}=${v.value}`), [
    "accounts/acct-ownerless.city=Phoenix", "accounts/acct-ownerless.phone=602-555-0000", "accounts/acct-ownerless.website=https://acme-website.example",
    "contacts/con-bravo-1.locationId=loc-bravo-flat",
  ]);
  assert.ok(!JSON.stringify(crm).includes("602-555-0000") && !JSON.stringify(crm).includes("acme-website.example"));
  const t = cleanSnapshot();
  t.contacts[0].data.title = "Owner";
  t.accounts[1].data.lineOfBusiness = "ACME";
  const conflict = run(t).census;
  assert.ok(codes(conflict, "con-alpha-ap").includes("CONTACT_TITLE_ROLE_CONFLICT"));
  assert.ok(codes(conflict, "acct-bravo").includes("LINE_OF_BUSINESS_SCALAR_UNMAPPABLE"));
});

test("RULING 5: a source id that the synthetic seed manifest also declares blocks the census", () => {
  const facts = { ...resolvingFacts(), declaredSyntheticIds: { accounts: ["acct-bravo"], contacts: [], locations: ["loc-alpha-main"] } };
  const { census } = run(cleanSnapshot(), facts);
  assert.deepEqual(census.findings.filter((f) => f.code === "SYNTHETIC_ID_CONFLICT").map((f) => f.id).sort(), ["acct-bravo", "loc-alpha-main"]);
});

test("GOVERNED / ENUM FIELDS: invalid paymentTerms, taxStatus, currency or relationship values block", () => {
  const s = cleanSnapshot();
  s.accounts[0].data.paymentTerms = "NET_45";
  s.accounts[1].data.taxStatus = "taxable";
  s.accounts[1].data.defaultCurrency = "usd";
  const { census } = run(s);
  assert.equal(census.findings.filter((f) => f.code === "FIELD_VALUE_INVALID" && ["paymentTerms", "taxStatus", "defaultCurrency"].includes(f.field)).length, 3);
});

// ════════════════════ timestamps ════════════════════

test("TIMESTAMPS: Timestamp and epoch millis both carry; absent updatedAt reads createdAt; absent/invalid createdAt blocks", () => {
  const s = cleanSnapshot();
  s.contacts[0].data.updatedAt = undefined;
  s.locations[0].data.createdAt = undefined;
  s.locations[1].data.createdAt = "2025-01-01";
  s.accounts[1].data.createdAt = ts("2025-03-03T00:00:00.000Z");
  s.accounts[1].data.updatedAt = 1_741_000_000_000;
  const { census, crm } = run(asFile(s));
  const c = crm.contacts.find((x) => x.id === "con-alpha-ap");
  assert.equal(c.updatedAt, c.createdAt);
  assert.ok(codes(census, "con-alpha-ap").includes("UPDATED_AT_ABSENT_USES_CREATED_AT"));
  assert.ok(codes(census, "loc-alpha-main").includes("CREATED_AT_ABSENT"));
  assert.ok(codes(census, "loc-bravo-flat").includes("CREATED_AT_INVALID"));
  assert.ok(codes(census, "acct-bravo").includes("TIMESTAMP_SHAPE_DRIFT"));
});

test("DUPLICATES: a repeated document id blocks every copy of it; duplicate folded names are advisory only", () => {
  const s = cleanSnapshot();
  s.contacts.push(contactDoc("con-bravo-1", "acct-bravo"));
  s.accounts.push(accountDoc("acct-charlie", { name: "FIXTURE CUSTOMER ACCT-ALPHA" }));
  const { census, crm } = run(s);
  assert.equal(census.findings.filter((f) => f.code === "DUPLICATE_ID").length, 2);
  assert.equal(crm.contacts.find((x) => x.id === "con-bravo-1"), undefined);
  assert.deepEqual(census.duplicateFoldedNames, [{ foldedName: "fixture customer acct-alpha", accountIds: ["acct-alpha", "acct-charlie"] }]);
});

// ════════════════════ the CLI's pre-client checks ════════════════════

test("the copy tool refuses a snapshot from another environment, project or production, and a checksum mismatch", () => {
  const { assertSnapshotSource, snapshotDigest } = require("../scripts/crmCutover.js");
  const parsed = (o) => parseCrmSnapshot(asFile(snapshotOf(o)));
  assert.doesNotThrow(() => assertSnapshotSource(parsed({}), "platform-sandbox"));
  assert.throws(() => assertSnapshotSource(parsed({ firebaseProjectId: "taylor-parts" }), "platform-sandbox"), /production project/);
  assert.throws(() => assertSnapshotSource(parsed({ environmentId: "local-emulator" }), "platform-sandbox"), /not --environment/);
  assert.throws(() => assertSnapshotSource(parsed({ firebaseProjectId: "someone-else" }), "platform-sandbox"), /declares 'eos-platform-sandbox'/);
  const dir = mkdtempSync(join(tmpdir(), "crm-digest-"));
  const file = join(dir, "s.json");
  writeFileSync(file, JSON.stringify(snapshotOf()));
  assert.throws(() => snapshotDigest(file, true), /\.sha256 is required for copy/);
  writeFileSync(`${file}.sha256`, `${"0".repeat(64)}  s.json\n`);
  assert.throws(() => snapshotDigest(file, false), /do not match/);
});

// ════════════════════ RULING 5: the synthetic flag is nonprod-only ════════════════════

test("RULING 5: --retainDeclaredSyntheticSeedRows is refused for production and undeclared environments, allowed for a sandbox", () => {
  const { assertSyntheticRetentionAllowed } = require("../scripts/crmCutover.js");
  assert.doesNotThrow(() => assertSyntheticRetentionAllowed({ environment: "platform-sandbox", retainDeclaredSyntheticSeedRows: "true" }));
  assert.doesNotThrow(() => assertSyntheticRetentionAllowed({ environment: "taylor-parts-production" }), "absent flag is not a refusal");
  assert.throws(() => assertSyntheticRetentionAllowed({ environment: "taylor-parts-production", retainDeclaredSyntheticSeedRows: "true" }), /nonprod-only/);
  assert.throws(() => assertSyntheticRetentionAllowed({ environment: "made-up", retainDeclaredSyntheticSeedRows: "true" }), /nonprod-only/);
  assert.throws(() => assertSyntheticRetentionAllowed({ environment: "platform-sandbox", retainDeclaredSyntheticSeedRows: "yes" }), /bare flag/);
});

// ════════════════════ RULING 6: the CRM writer state and the freeze boundary ════════════════════

const writerState = require("../lib/crm/crmWriterState.js");

test("RULING 6: the committed CRM writer state is Firestore OPEN / PostgreSQL INACTIVE, coherent, with the four legal moves only", () => {
  assert.deepEqual({ ...writerState.CRM_WRITER_AUTHORITY }, { firestore: "OPEN", postgres: "INACTIVE" });
  assert.doesNotThrow(() => writerState.assertCrmWriterAuthorityCoherent(writerState.CRM_WRITER_AUTHORITY));
  const S = (firestore, postgres) => ({ firestore, postgres });
  assert.equal(writerState.assertCrmWriterTransition(S("OPEN", "INACTIVE"), S("FROZEN", "INACTIVE")), "FREEZE");
  assert.equal(writerState.assertCrmWriterTransition(S("FROZEN", "INACTIVE"), S("OPEN", "INACTIVE")), "ROLLBACK_BEFORE_POSTGRES_WRITES");
  assert.equal(writerState.assertCrmWriterTransition(S("FROZEN", "INACTIVE"), S("FROZEN", "ACTIVE")), "ACTIVATE_POSTGRES");
  assert.equal(writerState.assertCrmWriterTransition(S("FROZEN", "ACTIVE"), S("RETIRED", "ACTIVE")), "RETIRE_FIRESTORE");
  assert.throws(() => writerState.assertCrmWriterAuthorityCoherent(S("OPEN", "ACTIVE")), /two authoritative/);
  assert.throws(() => writerState.assertCrmWriterTransition(S("FROZEN", "ACTIVE"), S("FROZEN", "INACTIVE")), (e) => e.code === "CRM_WRITER_TRANSITION_NOT_ALLOWED");
  assert.throws(() => writerState.assertCrmWriterTransition(S("RETIRED", "ACTIVE"), S("FROZEN", "INACTIVE")), (e) => e.code === "CRM_WRITER_TRANSITION_NOT_ALLOWED");
  for (const [id, w] of Object.entries(writerState.FIRESTORE_CRM_WRITERS)) {
    if (w.enforcement !== "SERVER_GUARD") { assert.throws(() => writerState.assertFirestoreCrmWriterOpen(id), /unknown server-side/); continue; }
    assert.doesNotThrow(() => writerState.assertFirestoreCrmWriterOpen(id));
    assert.throws(() => writerState.assertFirestoreCrmWriterOpen(id, S("FROZEN", "INACTIVE")), (e) => e.code === "FIRESTORE_CRM_WRITER_FROZEN" && e.writer === id);
    assert.throws(() => writerState.assertFirestoreCrmWriterOpen(id, S("RETIRED", "ACTIVE")), (e) => e.code === "FIRESTORE_CRM_WRITER_RETIRED");
  }
});

test("RULING 6: every server-side legacy CRM writer calls the guard with its own id BEFORE its first write", () => {
  const firstIndex = (code, patterns) => Math.min(...patterns.map((p) => { const m = p.exec(code); return m ? m.index : Infinity; }));
  const cases = [
    ["account.import", "src/account/accountImportCommand.ts", [/\bgetFirestore\(/, /runTransaction\(/, /txn\.set\(/]],
    ["crm.sandboxBaselineSeed", "scripts/seedSandboxBaseline.js", [/initializeApp\(\{/, /await upsert\(/]],
    ["crm.sandboxInboundSeed", "scripts/seedSandboxInboundWork.mjs", [/initializeApp\(\{/, /\.set\(data\)/]],
    ["crm.ownershipBackfill", "scripts/ownershipSandboxBackfill.js", [/tx\.set\(/, /runTransaction\(/]],
    ["crm.certificationAccountOwners", "scripts/certificationWorld/seedAccountOwners.mjs", [/batch\.set\(/, /batch\.commit\(/]],
  ];
  const guarded = new Set();
  for (const [id, file, writes] of cases) {
    const code = stripComments(readFileSync(file, "utf8"));
    const guard = code.indexOf(`assertFirestoreCrmWriterOpen("${id}"`);
    assert.ok(guard >= 0, `${file} does not call the CRM writer guard as ${id}`);
    const mainStart = Math.max(0, code.search(/async function main|export async function createAccountFromImport/));
    const firstWrite = firstIndex(code.slice(mainStart), writes) + mainStart;
    assert.ok(guard < firstWrite, `${file}: the guard must precede its first write`);
    guarded.add(id);
  }
  const serverWriters = Object.entries(writerState.FIRESTORE_CRM_WRITERS).filter(([, w]) => w.enforcement === "SERVER_GUARD").map(([id]) => id);
  assert.deepEqual([...guarded].sort(), serverWriters.sort(), "a server-side CRM writer is registered without a proved guard");
  // The customer import honours the freeze as a whole: before the job is claimed.
  const callables = stripComments(readFileSync("src/dataImport/dataImportCallables.ts", "utf8"));
  const exec = callables.slice(callables.indexOf("export const executeDataImportCallable"));
  assert.ok(exec.indexOf('assertFirestoreCrmWriterOpen("account.import")') >= 0);
  assert.ok(exec.indexOf('assertFirestoreCrmWriterOpen("account.import")') < exec.indexOf("claimForExecution"), "the freeze check must precede claiming the job");
});

test("RULING 6: a FROZEN CRM refuses the Firestore customer import before it touches Firestore", async () => {
  const { createAccountFromImport } = require("../lib/account/accountImportCommand.js");
  const poison = new Proxy({}, { get() { throw new Error("Firestore was touched"); } });
  await assert.rejects(
    createAccountFromImport({ actorUid: "u", idempotencyKey: "k", accountId: "acct-x", draft: { name: "X" } }, { db: poison, crmWriterAuthority: { firestore: "FROZEN", postgres: "INACTIVE" } }),
    (e) => e.code === "FIRESTORE_CRM_WRITER_FROZEN",
  );
});

// ════════════════════ RULING 2: the PostgreSQL customer import contract ════════════════════

const pgImport = require("../lib/crm/postgresCustomerImport.js");

test("RULING 2: the PostgreSQL customer import refuses an ownerless row, a free-text address, governed and unknown fields, missing facts", () => {
  const ok = { name: "Acme", status: "ACTIVE", ownerEmployeeId: "emp-owner-1", billingAddress: { street: "1 Way", city: "Town", state: "AZ", zip: "85001" } };
  assert.deepEqual(pgImport.preparePostgresCustomerImport(ok, "job-1:row-1"), { idempotencyKey: "job-1:row-1", ...ok });
  const refusal = (row, codeName) => assert.throws(() => pgImport.preparePostgresCustomerImport(row, "k"), (e) => e.name === "PostgresCustomerImportRefusal" && e.code === codeName, codeName);
  refusal({ name: "Acme", status: "ACTIVE" }, "OWNER_REQUIRED");
  refusal({ ...ok, ownerEmployeeId: null }, "OWNER_REQUIRED");
  refusal({ ...ok, ownerEmployeeId: "  " }, "OWNER_REQUIRED");
  refusal({ ...ok, billingAddress: "1 Way, Town, AZ 85001" }, "BILLING_ADDRESS_UNSTRUCTURED");
  refusal({ ...ok, paymentTerms: "NET_30" }, "GOVERNED_FIELD_REFUSED");
  refusal({ ...ok, accountOwner: { assignedToEmployeeId: "e" } }, "FIELD_NOT_ALLOWED");
  refusal({ ...ok, name: "" }, "NAME_REQUIRED");
  refusal({ ...ok, status: undefined }, "STATUS_REQUIRED");
});

test("RULING 2: the PostgreSQL customer import is unwired -- it refuses while PostgreSQL CRM writes are INACTIVE", async () => {
  await assert.rejects(
    pgImport.importCustomerToPostgres({ pool: null }, { tenantId: "t", principalId: "p", capabilities: new Set() }, { row: {}, idempotencyKey: "k" }),
    (e) => e.code === "POSTGRES_CRM_WRITER_INACTIVE",
  );
});
