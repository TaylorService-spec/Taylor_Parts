// THE OBJECT ADMINISTRATION PROFILE — its contract proof and its coverage proof.
//
// Three kinds of test here, and the third is the one that makes this layer worth having:
//
//   1. THE CONTRACT refuses the mistakes it exists to refuse (built from small invalid profiles).
//   2. THE REGISTRY is complete and agrees with the entity registry.
//   3. EVERY CITATION RESOLVES against the real repository — the file exists and contains the
//      symbol. Without this, a profile is just a second description of the backend, free to drift
//      the moment someone renames the enforcement it claims. With it, deleting `assertControlTypeImmutable`
//      breaks this test rather than quietly leaving a profile asserting an immutability nothing enforces.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  ADMIN_EDIT_SCOPE,
  MIGRATION_READINESS,
  MUTABILITY,
  REPRESENTATION_DISPOSITION,
  cite,
  editableFields,
  findCommand,
  findFieldPolicy,
  immutableFields,
  declaredCommandCapabilities,
  makeAdminEditing,
  makeCommandDescriptor,
  makeFieldPolicy,
  makeIdentityRule,
  makeMigrationStatus,
  makeObjectAdministrationProfile,
  makeOwnershipRule,
  makeReadModel,
  makeRepresentation,
  profileCitations,
  validateObjectAdministrationProfile,
  validateProfileAgainstEntity,
} from "../src/metadata/administration/objectAdministrationProfile.js";
import {
  ADMINISTRATION_PROFILES,
  administrationProfileCounts,
  findAdministrationProfile,
  hasAdministrationProfile,
  unprofiledEntities,
  validateAdministrationProfileRegistry,
} from "../src/metadata/administration/administrationProfileRegistry.js";
import { partAdministrationProfile } from "../src/metadata/administration/profiles/part.js";
import { findEntityById } from "../src/metadata/entityRegistry.js";

const PROFILES_DIR = "src/metadata/administration/profiles";
/** The repository root, from field-ops-app-vite/. Citations are root-relative on purpose. */
const REPO_ROOT = resolve(process.cwd(), "..");

/** A profile that passes every rule, so each negative case differs from it in ONE way. */
const validProfile = (overrides = {}) =>
  makeObjectAdministrationProfile({
    entityId: "part",
    identityRule: makeIdentityRule({
      idField: "partId",
      canonicalValidator: cite("functions/src/partMaster/validation.ts", "parsePartId"),
      neverSubstituted: ["an alias"],
    }),
    ownership: makeOwnershipRule({
      ownerClass: "REFERENCE",
      companyScope: "COMPANY_NEUTRAL",
      authority: cite("functions/src/ownership/ownershipMatrix.ts", "OWNERSHIP_MATRIX"),
    }),
    readModel: makeReadModel({ path: "CLIENT_DIRECT", collection: "parts", gate: "rules: role-based" }),
    fieldPolicies: [makeFieldPolicy({ fieldId: "name", mutability: MUTABILITY.MUTABLE })],
    commands: [
      makeCommandDescriptor({
        id: "updatePart",
        label: "Update part",
        phase: "UPDATE",
        transport: "CALLABLE",
        implementation: cite("functions/src/partMaster/partMasterCommands.ts", "updatePart"),
        capability: "inventory.catalog.manage",
        auditAction: "updatePart",
        versionChecked: true,
        idempotent: true,
        mutates: ["name"],
      }),
    ],
    migration: makeMigrationStatus({ readiness: MIGRATION_READINESS.NOT_ANALYZED }),
    adminEditing: makeAdminEditing({ scope: ADMIN_EDIT_SCOPE.NONE, reason: "nothing to configure yet" }),
    ...overrides,
  });

const complains = (profile, fragment) => {
  const problems = validateObjectAdministrationProfile(profile);
  assert.ok(
    problems.some((p) => p.includes(fragment)),
    `expected a problem mentioning "${fragment}", got:\n  ${problems.join("\n  ") || "(none)"}`,
  );
};

// ════════════════════════════ 1. THE CONTRACT ════════════════════════════

test("a well-formed profile is accepted", () => {
  assert.deepEqual(validateObjectAdministrationProfile(validProfile()), []);
});

test("a profile is data, never code", () => {
  // §8. The same check the entity contract applies, imported rather than rewritten.
  const profile = { ...validProfile(), description: () => "clever" };
  complains(profile, "executable value");
});

test("identity must name ONE canonicalization authority, never a second algorithm", () => {
  complains(
    validProfile({
      identityRule: makeIdentityRule({ idField: "partId", neverSubstituted: ["an alias"] }),
    }),
    "canonicalValidator",
  );
});

test("claiming the document id IS the identity requires citing what enforces it", () => {
  complains(
    validProfile({
      identityRule: makeIdentityRule({
        idField: "partId",
        documentIdIsIdentity: true,
        canonicalValidator: cite("functions/src/partMaster/validation.ts", "parsePartId"),
        neverSubstituted: ["an alias"],
      }),
    }),
    "cites nothing that enforces it",
  );
});

test("the things that must never be substituted for an id cannot be left unsaid", () => {
  complains(
    validProfile({
      identityRule: makeIdentityRule({
        idField: "partId",
        canonicalValidator: cite("functions/src/partMaster/validation.ts", "parsePartId"),
      }),
    }),
    "neverSubstituted is empty",
  );
});

test("a company-neutral object may not also carry an owning company field", () => {
  complains(
    validProfile({
      ownership: makeOwnershipRule({
        ownerClass: "REFERENCE",
        companyScope: "COMPANY_NEUTRAL",
        companyField: "businessLine",
        authority: cite("functions/src/ownership/ownershipMatrix.ts", "OWNERSHIP_MATRIX"),
      }),
    }),
    "company-neutral",
  );
});

test("a COMPANY-owned object must name the field that carries the company — it is never inferred", () => {
  complains(
    validProfile({
      ownership: makeOwnershipRule({
        ownerClass: "COMPANY",
        companyScope: "SINGLE_COMPANY",
        authority: cite("functions/src/ownership/ownershipMatrix.ts", "OWNERSHIP_MATRIX"),
      }),
    }),
    "names no companyField",
  );
});

test("an immutable field must cite where the change is actually refused", () => {
  complains(
    validProfile({
      fieldPolicies: [
        makeFieldPolicy({ fieldId: "name", mutability: MUTABILITY.MUTABLE }),
        makeFieldPolicy({ fieldId: "controlType", mutability: MUTABILITY.SET_AT_CREATE }),
      ],
    }),
    "SET_AT_CREATE must cite",
  );
});

test("a post-creation command may not mutate a SET_AT_CREATE field — the R2 regression guard", () => {
  // This is the test that stops a later change from widening `controlType` by adding it to an
  // update descriptor. Whichever half were wrong, both cannot stand.
  const profile = validProfile({
    fieldPolicies: [
      makeFieldPolicy({ fieldId: "name", mutability: MUTABILITY.MUTABLE }),
      makeFieldPolicy({
        fieldId: "controlType",
        mutability: MUTABILITY.SET_AT_CREATE,
        enforcedBy: cite("functions/src/partMaster/partMasterCommands.ts", "assertControlTypeImmutable"),
      }),
    ],
    commands: [
      makeCommandDescriptor({
        id: "updatePart",
        label: "Update part",
        phase: "UPDATE",
        transport: "CALLABLE",
        implementation: cite("functions/src/partMaster/partMasterCommands.ts", "updatePart"),
        capability: "inventory.catalog.manage",
        auditAction: "updatePart",
        versionChecked: true,
        mutates: ["name", "controlType"],
      }),
    ],
  });
  complains(profile, "mutates SET_AT_CREATE field \"controlType\"");
});

test("a command may not mutate a server-stamped or not-stored field", () => {
  const withMutates = (mutates, policies) =>
    validProfile({
      fieldPolicies: policies,
      commands: [
        makeCommandDescriptor({
          id: "updatePart",
          label: "Update part",
          phase: "UPDATE",
          transport: "CALLABLE",
          implementation: cite("functions/src/partMaster/partMasterCommands.ts", "updatePart"),
          capability: "inventory.catalog.manage",
          auditAction: "updatePart",
          versionChecked: true,
          mutates,
        }),
      ],
    });

  complains(
    withMutates(["name", "version"], [
      makeFieldPolicy({ fieldId: "name", mutability: MUTABILITY.MUTABLE }),
      makeFieldPolicy({ fieldId: "version", mutability: MUTABILITY.SYSTEM_MANAGED }),
    ]),
    "SYSTEM_MANAGED field",
  );
  complains(
    withMutates(["name", "unitCost"], [
      makeFieldPolicy({ fieldId: "name", mutability: MUTABILITY.MUTABLE }),
      makeFieldPolicy({ fieldId: "unitCost", mutability: MUTABILITY.NOT_STORED, heldBy: "nothing" }),
    ]),
    "declared NOT_STORED",
  );
  complains(withMutates(["name", "category"], [makeFieldPolicy({ fieldId: "name", mutability: MUTABILITY.MUTABLE })]), "declares no field policy");
});

test("a MUTABLE field no command can change is a promise nothing keeps", () => {
  complains(
    validProfile({
      fieldPolicies: [
        makeFieldPolicy({ fieldId: "name", mutability: MUTABILITY.MUTABLE }),
        makeFieldPolicy({ fieldId: "category", mutability: MUTABILITY.MUTABLE }),
      ],
    }),
    "is MUTABLE but no post-creation command names it",
  );
});

test("a governed command must declare its capability, its audit action and a version check", () => {
  const bare = (overrides) =>
    validProfile({
      commands: [
        makeCommandDescriptor({
          id: "updatePart",
          label: "Update part",
          phase: "UPDATE",
          transport: "CALLABLE",
          implementation: cite("functions/src/partMaster/partMasterCommands.ts", "updatePart"),
          capability: "inventory.catalog.manage",
          auditAction: "updatePart",
          versionChecked: true,
          mutates: ["name"],
          ...overrides,
        }),
      ],
    });
  complains(bare({ capability: null }), "must declare the capability");
  complains(bare({ auditAction: null }), "must declare the audit action");
  complains(bare({ versionChecked: false }), "cannot refuse a lost update");
  complains(bare({ implementation: null }), "must cite the code that implements it");
  complains(bare({ mutates: [] }), "declares no mutated fields");
});

test("exactly one representation is the authority, and a shim must say what blocks deleting it", () => {
  const authority = makeRepresentation({
    id: "a",
    label: "A",
    disposition: REPRESENTATION_DISPOSITION.AUTHORITY,
    location: cite("x", "y"),
  });
  complains(validProfile({ representations: [authority, { ...authority, id: "b", label: "B" }] }), "exactly one representation");
  complains(
    validProfile({
      representations: [
        authority,
        makeRepresentation({ id: "c", label: "C", disposition: REPRESENTATION_DISPOSITION.RETIRE, location: cite("x", "y") }),
      ],
    }),
    "must state what stands in the way",
  );
});

test("a BLOCKED migration must name its blockers, and a READY one its reconciliation proof", () => {
  complains(validProfile({ migration: makeMigrationStatus({ readiness: MIGRATION_READINESS.BLOCKED }) }), "names no blocker");
  complains(validProfile({ migration: makeMigrationStatus({ readiness: MIGRATION_READINESS.READY }) }), "states no reconciliation proof");
});

test("administration editing states its scope, its reason, and only commands the profile declares", () => {
  complains(validProfile({ adminEditing: makeAdminEditing({ scope: ADMIN_EDIT_SCOPE.NONE }) }), "reason is required");
  complains(
    validProfile({ adminEditing: makeAdminEditing({ scope: ADMIN_EDIT_SCOPE.GOVERNED_COMMAND, reason: "why" }) }),
    "must name the commands",
  );
  complains(
    validProfile({
      adminEditing: makeAdminEditing({ scope: ADMIN_EDIT_SCOPE.GOVERNED_COMMAND, reason: "why", commands: ["noSuchCommand"] }),
    }),
    "which this profile does not declare",
  );
  complains(
    validProfile({ adminEditing: makeAdminEditing({ scope: ADMIN_EDIT_SCOPE.NONE, reason: "why", commands: ["updatePart"] }) }),
    "scope does not permit dispatching any",
  );
});

test("a profile cannot describe a field the entity does not have", () => {
  const problems = validateProfileAgainstEntity(
    validProfile({ fieldPolicies: [makeFieldPolicy({ fieldId: "inventedField", mutability: MUTABILITY.NOT_STORED, heldBy: "nowhere" })] }),
    findEntityById("part"),
  );
  assert.ok(problems.some((p) => p.includes("inventedField")), problems.join("\n"));
});

test("a profile cannot claim a collection its entity does not declare", () => {
  const problems = validateProfileAgainstEntity(
    validProfile({ readModel: makeReadModel({ path: "CLIENT_DIRECT", collection: "partsCatalog", gate: "rules" }) }),
    findEntityById("part"),
  );
  assert.ok(problems.some((p) => p.includes("disagrees with entity")), problems.join("\n"));
});

// ════════════════════════════ 2. THE REGISTRY ════════════════════════════

test("every profile file in the profiles directory is registered", () => {
  const declared = [];
  for (const file of readdirSync(PROFILES_DIR)) {
    if (!file.endsWith(".js")) continue;
    const source = readFileSync(`${PROFILES_DIR}/${file}`, "utf8");
    for (const match of source.matchAll(/export const (\w+)\s*=\s*makeObjectAdministrationProfile\(/g)) {
      declared.push({ file, exportName: match[1] });
    }
  }
  assert.equal(
    ADMINISTRATION_PROFILES.length,
    declared.length,
    `${declared.length} profiles exist and ${ADMINISTRATION_PROFILES.length} are registered -- add the missing import`,
  );
});

test("the whole registry validates against the entity registry", () => {
  assert.deepEqual(validateAdministrationProfileRegistry(), []);
});

test("lookups answer, and an unknown entity is a question rather than a fault", () => {
  assert.equal(findAdministrationProfile("part")?.entityId, "part");
  assert.equal(findAdministrationProfile("nosuchthing"), null);
  assert.equal(hasAdministrationProfile("part"), true);
  assert.equal(hasAdministrationProfile("account"), false, "an entity with no profile yet is normal");
});

test("entities with no profile are counted, not hidden", () => {
  const counts = administrationProfileCounts();
  assert.equal(counts.profiled, ADMINISTRATION_PROFILES.length);
  assert.equal(counts.profiled + counts.unprofiled, counts.entities);
  assert.ok(unprofiledEntities().every((e) => !hasAdministrationProfile(e.id)));
});

// ════════════════════════════ 3. CITATIONS RESOLVE ════════════════════════════

test("every citation in every profile resolves to a real file containing that symbol", () => {
  const unresolved = [];
  for (const profile of ADMINISTRATION_PROFILES) {
    for (const citation of profileCitations(profile)) {
      const full = resolve(REPO_ROOT, citation.path);
      if (!existsSync(full)) {
        unresolved.push(`${profile.entityId}: ${citation.path} does not exist`);
        continue;
      }
      if (!readFileSync(full, "utf8").includes(citation.symbol)) {
        unresolved.push(`${profile.entityId}: ${citation.path} does not contain "${citation.symbol}"`);
      }
    }
  }
  assert.deepEqual(unresolved, [], `a profile is citing something that is not there:\n  ${unresolved.join("\n  ")}`);
});

test("Part cites enough to be worth citing", () => {
  // A profile that carried two citations would pass the test above and mean nothing.
  assert.ok(profileCitations(partAdministrationProfile).length >= 12);
});

// ════════════════════════════ PART, THE REFERENCE OBJECT ════════════════════════════

test("R1 — Part identity is partId, it IS the document id, and nothing substitutes for it", () => {
  const identity = partAdministrationProfile.identityRule;
  assert.equal(identity.idField, "partId");
  assert.equal(identity.documentIdIsIdentity, true);
  assert.equal(identity.canonicalValidator.symbol, "parsePartId", "the ONE canonicalization authority, reused");
  const forbidden = identity.neverSubstituted.join(" | ").toLowerCase();
  for (const shape of ["alias", "sku", "manufacturer part number", "name", "partscatalog", "spreadsheet"]) {
    assert.ok(forbidden.includes(shape), `neverSubstituted must name ${shape}`);
  }
});

test("R1 — the migration boundary gate exists and never returns a different string", () => {
  // Read from the real file: the contract's own guarantee, not a restatement of it here.
  const source = readFileSync(resolve(REPO_ROOT, "functions/src/eosOps/migration/partIdContract.ts"), "utf8");
  assert.ok(source.includes("export function requireCanonicalPartId"));
  assert.ok(source.includes("import { parsePartId }"), "it must borrow the one format rule, not restate it");
  assert.ok(source.includes("NOT_EXACT"), "a value needing a rewrite is refused, never trimmed into canonical form");
});

test("R2 — controlType is fixed at creation, and no post-creation command claims to change it", () => {
  const policy = findFieldPolicy(partAdministrationProfile, "controlType");
  assert.equal(policy.mutability, MUTABILITY.SET_AT_CREATE);
  assert.equal(policy.enforcedBy.symbol, "assertControlTypeImmutable");
  assert.ok(immutableFields(partAdministrationProfile).some((f) => f.fieldId === "controlType"));

  for (const command of partAdministrationProfile.commands) {
    if (command.phase === "CREATE") continue;
    assert.ok(!command.mutates.includes("controlType"), `${command.id} must not mutate controlType`);
  }
  assert.ok(findCommand(partAdministrationProfile, "createPart").mutates.includes("controlType"));

  // And the enforcement is really there, in the shape the profile describes: a VALUE comparison, so
  // `controlType` staying in the update allowlist (for an idempotent resend) is not a contradiction.
  const source = readFileSync(resolve(REPO_ROOT, "functions/src/partMaster/partMasterCommands.ts"), "utf8");
  assert.ok(source.includes("export function assertControlTypeImmutable"));
  assert.ok(source.includes("assertControlTypeImmutable(existing.part.controlType"), "updatePart must actually call it");
});

test("Part is company-neutral by classification, and the matrix says so", () => {
  const ownership = partAdministrationProfile.ownership;
  assert.equal(ownership.ownerClass, "REFERENCE");
  assert.equal(ownership.companyScope, "COMPANY_NEUTRAL");
  assert.equal(ownership.companyField, null);

  const matrix = readFileSync(resolve(REPO_ROOT, "functions/src/ownership/ownershipMatrix.ts"), "utf8");
  const reference = matrix.slice(matrix.indexOf("REFERENCE — company-neutral"));
  assert.ok(reference.includes('["part", "parts"]'), "part must sit in the REFERENCE block of the ownership matrix");
});

test("the three governed commands are the only write path, each with its own audit action", () => {
  const ids = partAdministrationProfile.commands.map((c) => c.id);
  assert.deepEqual(ids, ["createPart", "updatePart", "changePartStatus"]);
  for (const command of partAdministrationProfile.commands) {
    assert.equal(command.transport, "CALLABLE");
    assert.equal(command.idempotent, true, `${command.id} uses the house idempotency mechanism`);
    assert.ok(command.auditAction, `${command.id} records an audit action`);
  }
  // Status is a DIFFERENT authority from detail edits, and that separation is the point.
  assert.deepEqual(declaredCommandCapabilities(partAdministrationProfile), [
    "inventory.catalog.activate",
    "inventory.catalog.manage",
  ]);
  assert.equal(findCommand(partAdministrationProfile, "changePartStatus").capability, "inventory.catalog.activate");
});

test("reads are gated by role, not by a capability — stated, not invented", () => {
  const read = partAdministrationProfile.readModel;
  assert.equal(read.path, "CLIENT_DIRECT");
  assert.equal(read.collection, "parts");
  assert.equal(read.gateIsCapability, false);
  // The entity says the same thing. Two surfaces claiming different read gates is the drift this layer prevents.
  assert.equal(findEntityById("part").readCapability, null);
});

test("the static parts catalog is marked for retirement, with what blocks it named", () => {
  const rep = partAdministrationProfile.representations.find((r) => r.id === "staticPartsCatalog");
  assert.equal(rep.disposition, REPRESENTATION_DISPOSITION.RETIRE);
  assert.ok(rep.readBy.length >= 5, "the readers are what the retirement actually costs");
  assert.ok(rep.blockedBy);
  const authorities = partAdministrationProfile.representations.filter(
    (r) => r.disposition === REPRESENTATION_DISPOSITION.AUTHORITY,
  );
  assert.deepEqual(authorities.map((r) => r.id), ["partsCollection"]);
});

test("migration is BLOCKED, by named blockers, and nothing here can authorize a cutover", () => {
  const migration = partAdministrationProfile.migration;
  assert.equal(migration.readiness, MIGRATION_READINESS.BLOCKED);
  assert.ok(migration.blockedBy.length >= 4);
  assert.equal(migration.evaluator.symbol, "evaluateCutoverReadiness");
  assert.equal(migration.reconciliation, null, "no reconciliation proof exists yet, and saying so is the point");
});

test("Administration may change the object's presentation, never a Part record", () => {
  assert.equal(partAdministrationProfile.adminEditing.scope, ADMIN_EDIT_SCOPE.PRESENTATION_ONLY);
  assert.deepEqual(partAdministrationProfile.adminEditing.commands, []);
  assert.ok(partAdministrationProfile.adminEditing.reason.includes("inventory.catalog.manage"));
});

test("editableFields offers exactly what a governed command can actually change", () => {
  const editable = editableFields(partAdministrationProfile).map((f) => f.fieldId);
  assert.ok(editable.includes("name"));
  assert.ok(editable.includes("status"), "status is editable — through changePartStatus, not updatePart");
  for (const fixed of ["partId", "controlType", "version", "createdBy", "unitCost", "warehouseAvailable"]) {
    assert.ok(!editable.includes(fixed), `${fixed} must never be offered as editable`);
  }
});
