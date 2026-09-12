// EOS Metadata — the OBJECT ADMINISTRATION PROFILE (v1).
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §6/§7/§8, DECISIONS #102,
// ADR-013 (object list metadata authority).
//
// ════════════════════ WHY A NEW LAYER AND NOT A BIGGER EntityDefinition ════════════════════
//
// §7 of the boundary is explicit: entity/field/relationship metadata lives in
// `metadata/entityDefinition.js`, and page composition, list shape and action exposure are
// SEPARATE contracts that reference it by id. `listViewDefinition.js`, `pageDefinition.js` and
// `recordPageManifest.js` are the three that already exist. This is the fourth, and it answers the
// question none of them do:
//
//     WHAT DOES ADMINISTRATION NEED TO KNOW ABOUT THIS OBJECT TO GOVERN IT?
//
// Not what it looks like on a row (list view), not what its record page renders (page definition) —
// what its identity rule is, which of its fields may change after creation, which governed command
// changes each one, who owns it, which other representations of it still exist, and how far its
// migration has got. Administration → Objects is currently able to show an object's FIELDS and the
// CAPABILITIES that govern its four verbs; everything above is knowledge that today lives only in
// backend source comments, so the screen cannot state it and no test can hold it still.
//
// ════════════════════ WHAT THIS IS NOT ════════════════════
//
// NOT a second entity registry. A profile has no fields of its own: `entityId` names an entity in
// `metadata/entityRegistry.js`, and every `fieldId` a profile mentions must be a field THAT entity
// already declares. `validateProfileAgainstEntity` fails otherwise, so a profile can never quietly
// describe a field the model does not have.
//
// NOT a second permission model. Every capability id here is a DECLARATION handed to the real
// resolver (§6) — copied from the command that actually requires it, never invented. Nothing in
// this module returns a boolean meaning "allowed".
//
// NOT a second copy of the rules it describes. `controlType` is immutable because
// `functions/src/partMaster/partMasterCommands.ts` refuses to change it; this profile says so and
// CITES the enforcing symbol. A citation is checked (see `profileCitations` and the test that
// resolves every one against the real file), so a profile cannot claim an enforcement that does not
// exist, and deleting the enforcer breaks the claim rather than silently outliving it.
//
// NOT executable. §8 applies here exactly as it does to an EntityDefinition: no functions anywhere
// in a profile. The check is `findExecutable`, imported from the entity contract rather than
// written again.
//
// ════════════════════ HOW A LATER OBJECT JOINS ════════════════════
//
//   1. Write `administration/profiles/<entityId>.js` exporting
//      `export const <entityId>AdministrationProfile = makeObjectAdministrationProfile({...})`.
//   2. Add one import and one array entry to `administration/administrationProfileRegistry.js`.
//   3. `test/objectAdministrationProfile.test.mjs` then covers it automatically: the coverage test
//      fails if the file exists and the registry does not list it, and every declaration in it is
//      validated against the real EntityDefinition and the real cited source files.
//
// Nothing else is required, and nothing else may be invented: a profile that needs a vocabulary
// value this file does not define is a conversation about the vocabulary, not a local string.

import { findExecutable } from "../entityDefinition.js";

/**
 * WHAT MAY HAPPEN TO A FIELD AFTER THE RECORD EXISTS.
 *
 * The distinction this layer exists for. An Administration screen that cannot tell
 * "changeable by a command" from "fixed at creation" from "stamped by the server" can only offer
 * every field as editable and let the backend refuse — which is how an administrator learns the
 * rule from an error message instead of from the model.
 */
export const MUTABILITY = Object.freeze({
  /** Written once, at creation, and refused thereafter by a named enforcement. */
  SET_AT_CREATE: "SET_AT_CREATE",
  /** Changeable after creation, by a governed command this profile names. */
  MUTABLE: "MUTABLE",
  /** The server writes it; no caller supplies it and no command accepts it. */
  SYSTEM_MANAGED: "SYSTEM_MANAGED",
  /** Declared on the entity but not stored on this object at all — another authority holds it. */
  NOT_STORED: "NOT_STORED",
});

const MUTABILITIES = Object.freeze(Object.values(MUTABILITY));

/**
 * WHEN A COMMAND RUNS. Phase is what makes immutability checkable rather than decorative: a
 * SET_AT_CREATE field may appear in a CREATE command's `mutates` and in no other.
 */
export const COMMAND_PHASE = Object.freeze(["CREATE", "UPDATE", "LIFECYCLE", "RETIRE"]);

/** How a caller reaches a command. NONE means no client path exists — a real and common answer. */
export const COMMAND_TRANSPORT = Object.freeze(["CALLABLE", "TRUSTED_SERVER", "NONE"]);

/** How this object is read today. Mirrors READ_VIA and adds the mixed case honestly. */
export const READ_PATH = Object.freeze(["CLIENT_DIRECT", "CALLABLE", "SERVER_ONLY"]);

/**
 * WHAT A SECOND REPRESENTATION OF THE OBJECT IS FOR — and what should happen to it.
 *
 * Recorded because "prefer retirement over compatibility layers" is a decision somebody has to be
 * able to READ. A compatibility shim with no recorded disposition becomes permanent by default.
 */
export const REPRESENTATION_DISPOSITION = Object.freeze({
  /** The authority. Exactly one per object. */
  AUTHORITY: "AUTHORITY",
  /** A second representation that should be deleted, not adapted. */
  RETIRE: "RETIRE",
  /** A deliberate, flag-guarded bridge with a stated end. */
  COMPATIBILITY_SHIM: "COMPATIBILITY_SHIM",
  /** Derived from the authority and kept in step by construction (an index, an alias table). */
  DERIVED: "DERIVED",
});

const DISPOSITIONS = Object.freeze(Object.values(REPRESENTATION_DISPOSITION));

/** How far this object's move to the target authority has actually got. Evidence-backed only. */
export const MIGRATION_READINESS = Object.freeze({
  NOT_ANALYZED: "NOT_ANALYZED",
  ANALYZED: "ANALYZED",
  BLOCKED: "BLOCKED",
  READY: "READY",
  COMPLETE: "COMPLETE",
});

const READINESS = Object.freeze(Object.values(MIGRATION_READINESS));

/**
 * WHAT AN ADMINISTRATOR MAY CHANGE ON THIS SCREEN.
 *
 * Three states, not two, for the same reason the CRED grid draws three: "nothing may be edited
 * here" and "editing exists but only through a governed command elsewhere" are different answers,
 * and collapsing them sends an administrator either to look for a control that cannot exist or to
 * assume a control they were given writes the record.
 */
export const ADMIN_EDIT_SCOPE = Object.freeze({
  /** Nothing on this object is editable from Administration. */
  NONE: "NONE",
  /** Only the tenant's PRESENTATION of the object — label, plural, description. Never the data. */
  PRESENTATION_ONLY: "PRESENTATION_ONLY",
  /** Record data, through the named governed commands and nothing else. */
  GOVERNED_COMMAND: "GOVERNED_COMMAND",
});

const EDIT_SCOPES = Object.freeze(Object.values(ADMIN_EDIT_SCOPE));

/**
 * A CITATION: `path#symbol` as data.
 *
 * Every claim in a profile that asserts the platform BEHAVES some way carries one, and
 * `test/objectAdministrationProfile.test.mjs` resolves each against the real repository — the file
 * must exist and must contain the symbol. That is what keeps this layer from becoming a second,
 * drifting description of the backend: a claim whose enforcement was deleted or renamed fails a
 * test instead of quietly outliving the code it described.
 *
 * `path` is repository-root-relative, so one profile can cite functions/ and field-ops-app-vite/
 * alike without a convention per directory.
 */
export function cite(path, symbol) {
  return Object.freeze({ path, symbol });
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isCitation = (v) => isPlainObject(v) && typeof v.path === "string" && typeof v.symbol === "string";

/** Every citation anywhere in a profile, deduplicated, in a stable order. */
export function profileCitations(profile) {
  const out = new Map();
  const walk = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!isPlainObject(value)) return;
    if (isCitation(value)) {
      out.set(`${value.path}#${value.symbol}`, value);
      return;
    }
    Object.values(value).forEach(walk);
  };
  walk(profile);
  return Object.freeze([...out.values()].sort((a, b) => `${a.path}#${a.symbol}`.localeCompare(`${b.path}#${b.symbol}`)));
}

/**
 * THE IDENTITY RULE.
 *
 * `idField` is the entity field that IS the record's identity. `documentIdIsIdentity` records the
 * stronger claim — the stored value and the storage key are the same string — which is only
 * declarable with an `enforcedBy` citation, because an unenforced version of that claim is how a
 * document id becomes a fallback.
 *
 * `neverSubstituted` is the load-bearing list: the things that LOOK like identity and are not.
 * Writing them down is what makes "use the canonical id" reviewable rather than folklore.
 */
export function makeIdentityRule(input = {}) {
  return Object.freeze({
    idField: input.idField,
    documentIdIsIdentity: input.documentIdIsIdentity ?? false,
    /** The single canonicalization authority. Never a second algorithm written for this layer. */
    canonicalValidator: input.canonicalValidator ?? null,
    /** Where the stored-value-equals-document-id invariant is actually refused. */
    enforcedBy: input.enforcedBy ?? null,
    /** Values that must never be accepted in place of the id. */
    neverSubstituted: Object.freeze([...(input.neverSubstituted ?? [])]),
    /** How a NEW id comes into existence, when that is deterministic. */
    derivation: input.derivation ?? null,
    description: input.description ?? null,
  });
}

/**
 * OWNERSHIP AND OPERATING COMPANY.
 *
 * `ownerClass` and `companyScope` use the vocabulary of the ownership matrix
 * (functions/src/ownership/ownershipMatrix.ts) and are CITED to it rather than re-decided here.
 * A REFERENCE object has no owner and that is a classification, not an absence — `companyField`
 * being null on one is correct, and on a COMPANY-owned object is a gap.
 */
export function makeOwnershipRule(input = {}) {
  return Object.freeze({
    ownerClass: input.ownerClass,
    companyScope: input.companyScope,
    /** The stored operating-company field, or null where the object genuinely has none. */
    companyField: input.companyField ?? null,
    authority: input.authority ?? null,
    /** What must NOT be used to infer an owner or a company for this object. */
    prohibitedInference: Object.freeze([...(input.prohibitedInference ?? [])]),
    description: input.description ?? null,
  });
}

/** One field's administration policy. `fieldId` must be a field of the profile's entity. */
export function makeFieldPolicy(input = {}) {
  return Object.freeze({
    fieldId: input.fieldId,
    mutability: input.mutability,
    /** Required on create. Declared, never inferred from `absence`. */
    requiredAtCreate: input.requiredAtCreate ?? false,
    /** Where the mutability rule is actually enforced. Required for SET_AT_CREATE. */
    enforcedBy: input.enforcedBy ?? null,
    /** The other authority that holds it, for NOT_STORED. */
    heldBy: input.heldBy ?? null,
    reason: input.reason ?? null,
  });
}

/**
 * ONE GOVERNED COMMAND.
 *
 * `mutates` is a list of field ids, and it is what makes the immutability declaration checkable:
 * a SET_AT_CREATE field named by anything other than a CREATE command is a contradiction the
 * validator refuses. `capability`, `auditAction`, `versionChecked` and `idempotent` are copied
 * from the command itself and cited; they are declarations, never decisions (§6).
 */
export function makeCommandDescriptor(input = {}) {
  return Object.freeze({
    id: input.id,
    label: input.label,
    phase: input.phase,
    transport: input.transport ?? "NONE",
    /** The callable/adapter a client would reach, when one exists. */
    entryPoint: input.entryPoint ?? null,
    implementation: input.implementation ?? null,
    capability: input.capability ?? null,
    auditAction: input.auditAction ?? null,
    versionChecked: input.versionChecked ?? false,
    idempotent: input.idempotent ?? false,
    mutates: Object.freeze([...(input.mutates ?? [])]),
    description: input.description ?? null,
  });
}

/** How the object is read, and by whom. Records the reads an Administration reviewer must know. */
export function makeReadModel(input = {}) {
  return Object.freeze({
    path: input.path,
    collection: input.collection ?? null,
    /** How reads are gated today — a capability id, a rules predicate, or a stated absence. */
    gate: input.gate ?? null,
    gateIsCapability: input.gateIsCapability ?? false,
    authority: input.authority ?? null,
    description: input.description ?? null,
  });
}

/** A representation of the object that exists somewhere, and what should become of it. */
export function makeRepresentation(input = {}) {
  return Object.freeze({
    id: input.id,
    label: input.label,
    disposition: input.disposition,
    location: input.location ?? null,
    /** What it is still read by. Empty on an AUTHORITY row is meaningless; on a RETIRE row it is the work. */
    readBy: Object.freeze([...(input.readBy ?? [])]),
    /** Why it is not simply deleted today. Required on RETIRE and COMPATIBILITY_SHIM. */
    blockedBy: input.blockedBy ?? null,
    description: input.description ?? null,
  });
}

/** How far the move to the target authority has got, and what is holding it. */
export function makeMigrationStatus(input = {}) {
  return Object.freeze({
    readiness: input.readiness,
    /** The system that will hold this object after the move. */
    targetAuthority: input.targetAuthority ?? null,
    /** Where the source data comes from. */
    source: input.source ?? null,
    /** The module that decides readiness — never a judgement made in this file. */
    evaluator: input.evaluator ?? null,
    /** Named, quotable blockers. Required when readiness is BLOCKED. */
    blockedBy: Object.freeze([...(input.blockedBy ?? [])]),
    /** How a completed move would be proved. */
    reconciliation: input.reconciliation ?? null,
    description: input.description ?? null,
  });
}

/** What Administration may change here, and through what. */
export function makeAdminEditing(input = {}) {
  return Object.freeze({
    scope: input.scope,
    /** For GOVERNED_COMMAND: the command ids the surface is allowed to dispatch. */
    commands: Object.freeze([...(input.commands ?? [])]),
    /** Why the scope is what it is. Required — a refusal with no reason gets reversed. */
    reason: input.reason ?? null,
  });
}

/** THE PROFILE. Plain, frozen data about one registered entity. */
export function makeObjectAdministrationProfile(input = {}) {
  return Object.freeze({
    entityId: input.entityId,
    identityRule: input.identityRule ?? null,
    ownership: input.ownership ?? null,
    readModel: input.readModel ?? null,
    fieldPolicies: Object.freeze([...(input.fieldPolicies ?? [])]),
    commands: Object.freeze([...(input.commands ?? [])]),
    representations: Object.freeze([...(input.representations ?? [])]),
    migration: input.migration ?? null,
    adminEditing: input.adminEditing ?? null,
    description: input.description ?? null,
  });
}

/**
 * Validate one profile ON ITS OWN — everything that does not need the entity.
 * Returns problem strings; empty means valid.
 */
export function validateObjectAdministrationProfile(profile) {
  const problems = [];
  const at = profile?.entityId ? `profile ${profile.entityId}` : "profile (no entityId)";

  if (!profile?.entityId || typeof profile.entityId !== "string") {
    problems.push(`${at}: entityId is required and must name a registered entity`);
  }

  const exec = findExecutable(profile);
  if (exec) problems.push(`${at}: executable value at "${exec}" — a profile is data, never code (boundary §8)`);

  // ── identity ──────────────────────────────────────────────────────────────────────────────
  const identity = profile?.identityRule;
  if (!identity) {
    problems.push(`${at}: identityRule is required — an administered object must state what its id IS`);
  } else {
    if (!identity.idField) problems.push(`${at}: identityRule.idField is required`);
    if (!identity.canonicalValidator) {
      // Without this, every consumer eventually writes its own "is this a valid id" check, and the
      // second one disagrees with the first. Naming the one authority is the whole rule.
      problems.push(`${at}: identityRule must cite the single canonicalValidator — never a second algorithm`);
    }
    if (identity.documentIdIsIdentity && !identity.enforcedBy) {
      problems.push(
        `${at}: identityRule claims the document id IS the identity but cites nothing that enforces it — ` +
          `an unenforced version of that claim is exactly how a document id becomes a display fallback`,
      );
    }
    if (identity.neverSubstituted.length === 0) {
      problems.push(
        `${at}: identityRule.neverSubstituted is empty — the values that LOOK like this object's id and ` +
          `are not are the part a later reader cannot reconstruct`,
      );
    }
  }

  // ── ownership ─────────────────────────────────────────────────────────────────────────────
  const ownership = profile?.ownership;
  if (!ownership) {
    problems.push(`${at}: ownership is required — "who owns this" is not answerable by omission`);
  } else {
    if (!ownership.ownerClass) problems.push(`${at}: ownership.ownerClass is required`);
    if (!ownership.companyScope) problems.push(`${at}: ownership.companyScope is required`);
    if (!ownership.authority) {
      problems.push(`${at}: ownership must cite the ownership matrix it takes its classification from`);
    }
    if (ownership.ownerClass === "REFERENCE" && ownership.companyField) {
      problems.push(
        `${at}: ownership is REFERENCE (company-neutral) but names a companyField — a company-neutral ` +
          `object that carries an owning company is one of the two statements being wrong`,
      );
    }
    if (ownership.ownerClass === "COMPANY" && !ownership.companyField) {
      problems.push(`${at}: ownership is COMPANY but names no companyField — operating company is never inferred`);
    }
  }

  // ── read model ────────────────────────────────────────────────────────────────────────────
  const read = profile?.readModel;
  if (!read) {
    problems.push(`${at}: readModel is required`);
  } else {
    if (!READ_PATH.includes(read.path)) problems.push(`${at}: readModel.path "${read.path}" is not a known READ_PATH`);
    if (read.path === "CLIENT_DIRECT" && !read.collection) {
      problems.push(`${at}: readModel.path CLIENT_DIRECT requires the collection it reads`);
    }
    if (!read.gate) {
      problems.push(`${at}: readModel.gate is required — state the capability, the rules predicate, or that none exists`);
    }
  }

  // ── field policies ────────────────────────────────────────────────────────────────────────
  const seenFields = new Set();
  for (const policy of profile?.fieldPolicies ?? []) {
    const where = `${at}: field ${policy?.fieldId ?? "(no id)"}`;
    if (!policy?.fieldId) problems.push(`${where}: fieldId is required`);
    else if (seenFields.has(policy.fieldId)) problems.push(`${where}: declared twice`);
    else seenFields.add(policy.fieldId);

    if (!MUTABILITIES.includes(policy?.mutability)) {
      problems.push(`${where}: mutability "${policy?.mutability}" is not a known MUTABILITY`);
    }
    if (policy?.mutability === MUTABILITY.SET_AT_CREATE && !policy.enforcedBy) {
      // "Immutable" that nothing refuses is a comment, and a comment does not stop an update.
      problems.push(`${where}: SET_AT_CREATE must cite where the change is actually refused`);
    }
    if (policy?.mutability === MUTABILITY.NOT_STORED && !policy.heldBy) {
      problems.push(`${where}: NOT_STORED must name the authority that does hold it`);
    }
  }

  // ── commands ──────────────────────────────────────────────────────────────────────────────
  const commandIds = new Set();
  for (const command of profile?.commands ?? []) {
    const where = `${at}: command ${command?.id ?? "(no id)"}`;
    if (!command?.id) problems.push(`${where}: id is required`);
    else if (commandIds.has(command.id)) problems.push(`${where}: declared twice`);
    else commandIds.add(command.id);

    if (!command?.label) problems.push(`${where}: label is required`);
    if (command?.id && command.id === command.label) problems.push(`${where}: id and label must be distinct concepts`);
    if (!COMMAND_PHASE.includes(command?.phase)) problems.push(`${where}: phase "${command?.phase}" is not a known COMMAND_PHASE`);
    if (!COMMAND_TRANSPORT.includes(command?.transport)) {
      problems.push(`${where}: transport "${command?.transport}" is not a known COMMAND_TRANSPORT`);
    }
    if (!command?.implementation) problems.push(`${where}: must cite the code that implements it`);
    if (!command?.capability) {
      // A governed write with no declared capability cannot be reviewed at all: nothing downstream
      // can even ask the resolver the right question.
      problems.push(`${where}: must declare the capability it requires (a declaration, never a decision)`);
    }
    if (!command?.auditAction) {
      problems.push(`${where}: must declare the audit action it records — an unaudited governed write is not governed`);
    }
    if (command?.phase !== "CREATE" && !command?.versionChecked) {
      problems.push(
        `${where}: a post-creation command that does not check the stored version cannot refuse a lost update`,
      );
    }
    if ((command?.mutates?.length ?? 0) === 0) {
      problems.push(`${where}: declares no mutated fields — a command that changes nothing is not a command`);
    }
  }

  // ── the check this layer exists for ───────────────────────────────────────────────────────
  //
  // A field declared SET_AT_CREATE or SYSTEM_MANAGED, named by a command that runs AFTER creation,
  // is a contradiction. Whichever half is wrong, both cannot stand: either the profile is lying
  // about immutability or a command is changing something it must not. Catching it here means a
  // later lane cannot quietly widen an immutable field by adding it to an update descriptor.
  const mutabilityById = new Map((profile?.fieldPolicies ?? []).map((p) => [p.fieldId, p.mutability]));
  for (const command of profile?.commands ?? []) {
    for (const fieldId of command?.mutates ?? []) {
      const mutability = mutabilityById.get(fieldId);
      if (mutability === undefined) {
        problems.push(
          `${at}: command ${command.id} mutates "${fieldId}", which declares no field policy — ` +
            `a field a command writes is a field whose mutability must be stated`,
        );
        continue;
      }
      if (mutability === MUTABILITY.SYSTEM_MANAGED) {
        problems.push(`${at}: command ${command.id} mutates SYSTEM_MANAGED field "${fieldId}" — the server stamps it, no caller supplies it`);
      }
      if (mutability === MUTABILITY.NOT_STORED) {
        problems.push(`${at}: command ${command.id} mutates "${fieldId}", declared NOT_STORED on this object`);
      }
      if (mutability === MUTABILITY.SET_AT_CREATE && command.phase !== "CREATE") {
        problems.push(
          `${at}: command ${command.id} (${command.phase}) mutates SET_AT_CREATE field "${fieldId}" — ` +
            `it is fixed at creation, so either the policy or the command is wrong`,
        );
      }
    }
  }

  // A MUTABLE field nothing can change is metadata promising an edit no path delivers.
  const mutatedAfterCreate = new Set(
    (profile?.commands ?? []).filter((c) => c.phase !== "CREATE").flatMap((c) => [...(c.mutates ?? [])]),
  );
  for (const policy of profile?.fieldPolicies ?? []) {
    if (policy?.mutability !== MUTABILITY.MUTABLE) continue;
    if (!mutatedAfterCreate.has(policy.fieldId)) {
      problems.push(
        `${at}: field ${policy.fieldId} is MUTABLE but no post-creation command names it — ` +
          `declare the command that changes it, or it is not mutable`,
      );
    }
  }

  // ── representations ───────────────────────────────────────────────────────────────────────
  const repIds = new Set();
  let authorities = 0;
  for (const rep of profile?.representations ?? []) {
    const where = `${at}: representation ${rep?.id ?? "(no id)"}`;
    if (!rep?.id) problems.push(`${where}: id is required`);
    else if (repIds.has(rep.id)) problems.push(`${where}: declared twice`);
    else repIds.add(rep.id);
    if (!rep?.label) problems.push(`${where}: label is required`);
    if (!DISPOSITIONS.includes(rep?.disposition)) {
      problems.push(`${where}: disposition "${rep?.disposition}" is not a known REPRESENTATION_DISPOSITION`);
    }
    if (!rep?.location) problems.push(`${where}: must cite where it lives`);
    if (rep?.disposition === REPRESENTATION_DISPOSITION.AUTHORITY) authorities += 1;
    if (
      (rep?.disposition === REPRESENTATION_DISPOSITION.RETIRE ||
        rep?.disposition === REPRESENTATION_DISPOSITION.COMPATIBILITY_SHIM) &&
      !rep?.blockedBy
    ) {
      // Without this, "retire it" has no owner and no next step, and the shim outlives everyone
      // who remembers why it was temporary.
      problems.push(`${where}: ${rep.disposition} must state what stands in the way of deleting it`);
    }
  }
  if ((profile?.representations?.length ?? 0) > 0 && authorities !== 1) {
    problems.push(`${at}: exactly one representation is the AUTHORITY — found ${authorities}`);
  }

  // ── migration ─────────────────────────────────────────────────────────────────────────────
  const migration = profile?.migration;
  if (!migration) {
    problems.push(`${at}: migration status is required — "not analyzed" is a status, not an omission`);
  } else {
    if (!READINESS.includes(migration.readiness)) {
      problems.push(`${at}: migration.readiness "${migration.readiness}" is not a known MIGRATION_READINESS`);
    }
    if (migration.readiness === MIGRATION_READINESS.BLOCKED && migration.blockedBy.length === 0) {
      problems.push(`${at}: migration is BLOCKED but names no blocker — an unnamed blocker cannot be cleared`);
    }
    if (
      (migration.readiness === MIGRATION_READINESS.READY || migration.readiness === MIGRATION_READINESS.COMPLETE) &&
      !migration.reconciliation
    ) {
      problems.push(`${at}: migration is ${migration.readiness} but states no reconciliation proof`);
    }
  }

  // ── administration editing ────────────────────────────────────────────────────────────────
  const editing = profile?.adminEditing;
  if (!editing) {
    problems.push(`${at}: adminEditing is required — state what Administration may change, including "nothing"`);
  } else {
    if (!EDIT_SCOPES.includes(editing.scope)) {
      problems.push(`${at}: adminEditing.scope "${editing.scope}" is not a known ADMIN_EDIT_SCOPE`);
    }
    if (!editing.reason) problems.push(`${at}: adminEditing.reason is required — a refusal with no reason gets reversed`);
    if (editing.scope === ADMIN_EDIT_SCOPE.GOVERNED_COMMAND && editing.commands.length === 0) {
      problems.push(`${at}: adminEditing scope GOVERNED_COMMAND must name the commands the surface may dispatch`);
    }
    if (editing.scope !== ADMIN_EDIT_SCOPE.GOVERNED_COMMAND && editing.commands.length > 0) {
      problems.push(`${at}: adminEditing names commands but its scope does not permit dispatching any`);
    }
    for (const id of editing.commands) {
      if (!commandIds.has(id)) problems.push(`${at}: adminEditing names command "${id}", which this profile does not declare`);
    }
  }

  return problems;
}

/**
 * The checks that need the EntityDefinition: a profile describes an entity's fields, and a
 * fieldId that is not one of them is a description of something that does not exist.
 */
export function validateProfileAgainstEntity(profile, entity) {
  const problems = [];
  const at = `profile ${profile?.entityId ?? "(no entityId)"}`;

  if (!entity) {
    problems.push(`${at}: names no registered entity — a profile governs an entity that exists`);
    return problems;
  }

  const fieldIds = new Set((entity.fields ?? []).map((f) => f.id));
  for (const policy of profile?.fieldPolicies ?? []) {
    if (policy?.fieldId && !fieldIds.has(policy.fieldId)) {
      problems.push(`${at}: field policy names "${policy.fieldId}", which is not a field on entity ${entity.id}`);
    }
  }
  for (const command of profile?.commands ?? []) {
    for (const fieldId of command?.mutates ?? []) {
      if (!fieldIds.has(fieldId)) {
        problems.push(`${at}: command ${command.id} mutates "${fieldId}", which is not a field on entity ${entity.id}`);
      }
    }
  }
  if (profile?.identityRule?.idField && !fieldIds.has(profile.identityRule.idField)) {
    problems.push(`${at}: identityRule.idField "${profile.identityRule.idField}" is not a field on entity ${entity.id}`);
  }
  if (profile?.ownership?.companyField && !fieldIds.has(profile.ownership.companyField)) {
    problems.push(`${at}: ownership.companyField "${profile.ownership.companyField}" is not a field on entity ${entity.id}`);
  }
  if (profile?.readModel?.collection && entity.collection && profile.readModel.collection !== entity.collection) {
    problems.push(
      `${at}: readModel.collection "${profile.readModel.collection}" disagrees with entity ${entity.id}'s ` +
        `declared collection "${entity.collection}"`,
    );
  }

  return problems;
}

/** Lookups. Pure, no I/O, no authorization. */
export const findFieldPolicy = (profile, fieldId) =>
  (profile?.fieldPolicies ?? []).find((p) => p.fieldId === fieldId) ?? null;

export const findCommand = (profile, commandId) =>
  (profile?.commands ?? []).find((c) => c.id === commandId) ?? null;

/** The fields a governed path can change after creation, which is what an edit surface may offer. */
export const editableFields = (profile) => {
  const mutated = new Set(
    (profile?.commands ?? []).filter((c) => c.phase !== "CREATE").flatMap((c) => [...(c.mutates ?? [])]),
  );
  return Object.freeze((profile?.fieldPolicies ?? []).filter((p) => p.mutability === MUTABILITY.MUTABLE && mutated.has(p.fieldId)));
};

/** The fields fixed at creation. Stated positively so a surface can SHOW the rule, not just obey it. */
export const immutableFields = (profile) =>
  Object.freeze((profile?.fieldPolicies ?? []).filter((p) => p.mutability === MUTABILITY.SET_AT_CREATE));

/** The capability ids a profile declares. Handed to the real resolver; never evaluated here (§6). */
export function declaredCommandCapabilities(profile) {
  const out = new Set();
  for (const command of profile?.commands ?? []) if (command.capability) out.add(command.capability);
  return [...out].sort();
}
