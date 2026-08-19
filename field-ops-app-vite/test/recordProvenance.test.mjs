// Record provenance — the platform invariant.
//
// Invariants, not descriptions. Each states something the platform must be true of
// itself, and would fail if an implementation drifted toward the convenient answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  provenanceFields, validateProvenance, makeProvenanceExemption,
  PROVENANCE_SYSTEM_NAMES, PROVENANCE_SYNONYMS, PROVENANCE_ORIGIN, PROVENANCE_ORIGIN_SEAM,
} from "../src/metadata/v2/provenance.js";
import { validateFieldV2 } from "../src/metadata/v2/fieldDefinitionV2.js";

const entity = (fields, over = {}) => ({ systemName: "account", fields, ...over });

test("a mutable durable record needs all four provenance fields", () => {
  const fields = provenanceFields({ entitySystemName: "account" });
  assert.deepEqual(fields.map((f) => f.systemName), [...PROVENANCE_SYSTEM_NAMES]);
  assert.deepEqual(validateProvenance(entity(fields)), []);
});

test("an entity missing provenance fails the invariant, naming what is missing", () => {
  const problems = validateProvenance(entity([{ systemName: "name" }]));
  assert.equal(problems.length, 4);
  assert.ok(problems.every((p) => /require/.test(p)));
});

test("an APPEND-ONLY record has an origin and no last-changed", () => {
  // An issued invoice or a posted ledger entry has no mutation path. Emitting
  // updatedAt/updatedBy would imply one that must not exist.
  const fields = provenanceFields({ entitySystemName: "invoice", mutable: false });
  assert.deepEqual(fields.map((f) => f.systemName), ["createdAt", "createdBy"]);
  assert.deepEqual(validateProvenance(entity(fields, { mutable: false })), []);
});

test("createdAt and createdBy are immutable after creation", () => {
  for (const f of provenanceFields({ entitySystemName: "account" })) {
    if (f.systemName.startsWith("created")) assert.equal(f.mutable, false, f.systemName);
  }
});

test("no provenance field is directly updateable — server-authoritative means server-written", () => {
  // A client-supplied timestamp or actor is a CLAIM: any caller who can write the record
  // can write the claim. There is no authority under which a caller sets provenance.
  for (const f of provenanceFields({ entitySystemName: "account" })) {
    assert.equal(f.updateable, false, f.systemName);
    assert.equal(f.createable, false, f.systemName);
    assert.equal(f.writeCapability, null, f.systemName);
  }
});

test("an admin may not redefine a provenance field as a business field", () => {
  const fields = [...provenanceFields({ entitySystemName: "account" })].map((f) =>
    f.systemName === "createdBy" ? { ...f, fieldClass: "STANDARD" } : f
  );
  assert.ok(validateProvenance(entity(fields)).some((p) => /may not be redefined/.test(p)));
});

test("a synonym is rejected rather than quietly coexisting", () => {
  // Two answers to one question means every report, formula and export has to pick one.
  for (const synonym of ["creationDate", "lastModified", "dateCreated"]) {
    assert.ok(PROVENANCE_SYNONYMS.includes(synonym), synonym);
    const fields = [...provenanceFields({ entitySystemName: "account" }), { systemName: synonym }];
    assert.ok(validateProvenance(entity(fields)).some((p) => /duplicates a standard provenance concept/.test(p)), synonym);
  }
});

test("legacy storage is handled with storagePath, not with a second name", () => {
  const fields = provenanceFields({
    entitySystemName: "account",
    storagePaths: { createdAt: "legacy.created_on" },
  });
  const createdAt = fields.find((f) => f.systemName === "createdAt");
  assert.equal(createdAt.systemName, "createdAt");
  assert.equal(createdAt.storagePath, "legacy.created_on");
  assert.deepEqual(validateProvenance(entity(fields)), []);
});

test("an exemption requires a stated reason", () => {
  // Caches and locks are not business records. But an exemption without a reason is a gap
  // somebody left, not a decision somebody made.
  const unexplained = makeProvenanceExemption({ entitySystemName: "lock" });
  assert.ok(validateProvenance(entity([]), { exemption: unexplained }).some((p) => /requires a stated reason/.test(p)));

  const explained = makeProvenanceExemption({ entitySystemName: "lock", reason: "Transient execution lock; not a durable business record." });
  assert.deepEqual(validateProvenance(entity([]), { exemption: explained }), []);
});

test("provenance fields are valid v2 fields, not a parallel shape", () => {
  for (const f of provenanceFields({ entitySystemName: "account" })) {
    assert.deepEqual(validateFieldV2(f), [], f.systemName);
    assert.equal(f.fieldClass, "SYSTEM");
    assert.equal(f.auditable, true);
  }
});

test("origin is not assumed to be a human at a keyboard", () => {
  // "A dispatcher did this" and "an import did this on a dispatcher's behalf" is the
  // first question asked when data looks wrong.
  for (const origin of ["USER", "AUTOMATION", "IMPORT", "INTEGRATION", "SYSTEM", "AI_ASSISTED"]) {
    assert.ok(PROVENANCE_ORIGIN.includes(origin), origin);
  }
});

test("the origin seam points at the existing audit architecture rather than replacing it", () => {
  // Inventing a parallel actor vocabulary is exactly what the addendum forbids.
  assert.match(PROVENANCE_ORIGIN_SEAM.reconcileWith, /auditEventWriter/);
  assert.ok(PROVENANCE_ORIGIN_SEAM.fields.includes("sourceExecutionId"));
  assert.ok(PROVENANCE_ORIGIN_SEAM.fields.includes("correlationId"));
});
