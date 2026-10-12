// GOVERNED FIELD GROUPS -- the generic, Object-level field-permission evaluator (Owner field-permission directive,
// 2026-10-11: "EOS must support business-process permissions through its governed Employee -> Security Role -> Object ->
// Field model ... Use existing EOS capability and field-policy mechanisms ... Do not create a separate supplier-specific
// permission system").
//
// WHAT IT IS. An Object's fields are partitioned into named GROUPS. Each group states, per access mode, the REGISTERED
// capability key(s) that govern it -- the same eos_policy.capabilities rows Administration grants to Security Roles and the
// resolver (capabilityAuthority.resolveOperationalContext) composes into the caller's effective capability set. This
// module never resolves anything itself: the caller passes the ALREADY-RESOLVED capability Set of the authenticated
// Principal (its Roles' grants, plus anything Protected Administrator standing implies -- and standing implies only what
// protectedAdministrator.ts allows). Nothing here reads a persona name, a Role key, a title or a Job Role.
//
// DECISIONS #210: "Objects matrix columns are real capabilities plus governed field groups (e.g. account.editGovernedField
// = customer.governedField.write)". A field group IS that: a capability on the Object, scoped to named fields. The retired
// per-Role field overrides (role_field_permission_overrides) are NOT revived -- a group's authority is a capability, so it
// is granted, revoked and audited exactly as every other capability is.
//
// SEMANTICS.
//   requirement null       "governed by the record's own gate": the command already checked the record-level capability
//                           (e.g. inventory.catalog.manage) before it got here, so the group adds nothing.
//   requirement "k"        the caller must hold k.
//   requirement ["a","b"]  the caller must hold EVERY listed key (all-of). Used where an Owner ruling composes two
//                           authorities (r1: the cost projection requires inventory.catalog.read AND .cost.read).
//   Capabilities are ADDITIVE: the Set is the union of every Role the Principal holds, and holding more keys can only
//   widen access, never narrow it. FAIL CLOSED: a field no group declares is never projected and never writable; an
//   unknown group is never readable.
//
// PURE: no I/O, no clock, no randomness. Every function is deterministic in (definition, capabilities, record).

export type FieldAccessMode = "read" | "create" | "edit";
export type CapabilityRequirement = string | readonly string[] | null;

export interface FieldGroupDefinition {
  readonly key: string;
  readonly label: string;
  readonly fields: readonly string[];
  readonly read: CapabilityRequirement;
  readonly create: CapabilityRequirement;
  readonly edit: CapabilityRequirement;
  /** A sensitive group's VALUES never reach an audit row (auditSafe) -- only the names of the fields involved. */
  readonly sensitive: boolean;
}

export interface ObjectFieldGroups {
  readonly objectKey: string;
  readonly groups: readonly FieldGroupDefinition[];
}

export interface GroupAccess {
  readonly read: boolean;
  readonly create: boolean;
  readonly edit: boolean;
}

/** One withheld group in a projection: names only, never a value. `requires` = every key the group needs (all-of). */
export interface WithheldGroup {
  readonly group: string;
  readonly fields: readonly string[];
  readonly requires: readonly string[];
}

/** A governed refusal. `category` is the transport category; nothing in it carries a record value. */
export class GovernedFieldGroupError extends Error {
  constructor(
    readonly code: "FIELD_GROUP_FORBIDDEN" | "FIELD_NOT_GOVERNED",
    readonly category: "FORBIDDEN",
    message: string,
    readonly details: Readonly<{ objectKey: string; group: string | null; fields: readonly string[]; requires: readonly string[] }>,
  ) {
    super(message);
    this.name = "GovernedFieldGroupError";
  }
}

/** Validate a definition once, at module load: every field in exactly one group, every group key unique. */
export function defineFieldGroups(def: ObjectFieldGroups): ObjectFieldGroups {
  const seenGroups = new Set<string>();
  const seenFields = new Map<string, string>();
  if (typeof def.objectKey !== "string" || def.objectKey === "") throw new Error("governedFieldGroups: objectKey is required");
  for (const g of def.groups) {
    if (seenGroups.has(g.key)) throw new Error(`governedFieldGroups: ${def.objectKey} declares group ${g.key} twice`);
    seenGroups.add(g.key);
    for (const mode of ["read", "create", "edit"] as const) {
      const r = g[mode];
      if (r === null) continue;
      const keys = typeof r === "string" ? [r] : r;
      if (!Array.isArray(keys) || keys.length === 0 || keys.some((k) => typeof k !== "string" || k === "")) {
        throw new Error(`governedFieldGroups: ${def.objectKey}.${g.key}.${mode} must be null, a capability key or a non-empty list of keys`);
      }
    }
    for (const f of g.fields) {
      const other = seenFields.get(f);
      if (other !== undefined) throw new Error(`governedFieldGroups: ${def.objectKey} field ${f} is in both ${other} and ${g.key}`);
      seenFields.set(f, g.key);
    }
  }
  return Object.freeze({
    objectKey: def.objectKey,
    groups: Object.freeze(def.groups.map((g) => Object.freeze({ ...g, fields: Object.freeze([...g.fields]) }))),
  });
}

const requiredKeys = (r: CapabilityRequirement): readonly string[] => (r === null ? [] : typeof r === "string" ? [r] : r);
const holds = (caps: ReadonlySet<string>, r: CapabilityRequirement): boolean =>
  caps instanceof Set && requiredKeys(r).every((k) => caps.has(k));

/** The group that governs `field`, or null when no group declares it (fail closed: such a field is never exposed). */
export function groupOf(def: ObjectFieldGroups, field: string): FieldGroupDefinition | null {
  return def.groups.find((g) => g.fields.includes(field)) ?? null;
}

/** The caller's read / create / edit decision for every group. The UI renders from THIS, never from a Role name. */
export function fieldAccessFor(def: ObjectFieldGroups, caps: ReadonlySet<string>): Readonly<Record<string, GroupAccess>> {
  const out: Record<string, GroupAccess> = {};
  for (const g of def.groups) {
    out[g.key] = Object.freeze({ read: holds(caps, g.read), create: holds(caps, g.create), edit: holds(caps, g.edit) });
  }
  return Object.freeze(out);
}

/**
 * The record as THIS caller may see it. Every field of a group the caller cannot read is REMOVED (absent, never null --
 * a null would itself be a value), every field no group declares is removed (fail closed), and `withheld` names the
 * withheld groups, their fields and the keys they require -- never a value. A field the record does not carry is not
 * fabricated, and a withheld group is reported only when the record actually carried at least one of its fields.
 */
export function projectForCaller<T extends Record<string, unknown>>(
  def: ObjectFieldGroups, caps: ReadonlySet<string>, record: T,
): Record<string, unknown> & { withheld: readonly WithheldGroup[] } {
  const out: Record<string, unknown> = {};
  const withheld: WithheldGroup[] = [];
  const src = record && typeof record === "object" && !Array.isArray(record) ? record : ({} as T);
  for (const g of def.groups) {
    const present = g.fields.filter((f) => Object.prototype.hasOwnProperty.call(src, f));
    if (holds(caps, g.read)) {
      for (const f of present) out[f] = src[f];
    } else if (present.length > 0) {
      withheld.push(Object.freeze({ group: g.key, fields: Object.freeze([...g.fields]), requires: Object.freeze([...requiredKeys(g.read)]) }));
    }
  }
  return Object.assign(out, { withheld: Object.freeze(withheld) });
}

/**
 * Refuse unless the caller may write EVERY named field in `mode`. FIELD_NOT_GOVERNED for a field no group declares
 * (fail closed -- an undeclared field is never writable by accident); FIELD_GROUP_FORBIDDEN naming the first group the
 * caller lacks and the capability key(s) it requires. The message carries field NAMES and capability KEYS only.
 */
export function assertWritable(def: ObjectFieldGroups, caps: ReadonlySet<string>, mode: "create" | "edit", fieldKeys: readonly string[]): void {
  const ungoverned = fieldKeys.filter((f) => groupOf(def, f) === null);
  if (ungoverned.length > 0) {
    throw new GovernedFieldGroupError("FIELD_NOT_GOVERNED", "FORBIDDEN",
      `FIELD_NOT_GOVERNED: ${def.objectKey} has no field group for ${[...ungoverned].sort().join(", ")}`,
      { objectKey: def.objectKey, group: null, fields: Object.freeze([...ungoverned].sort()), requires: Object.freeze([]) });
  }
  for (const g of def.groups) {
    const named = fieldKeys.filter((f) => g.fields.includes(f));
    if (named.length === 0 || holds(caps, g[mode])) continue;
    const requires = requiredKeys(g[mode]);
    throw new GovernedFieldGroupError("FIELD_GROUP_FORBIDDEN", "FORBIDDEN",
      `FIELD_GROUP_FORBIDDEN: ${mode === "create" ? "setting" : "changing"} ${g.label} (${[...named].sort().join(", ")}) requires ${requires.join(" and ")}`,
      { objectKey: def.objectKey, group: g.key, fields: Object.freeze([...named].sort()), requires: Object.freeze([...requires]) });
  }
}

/** The audit marker that replaces a sensitive value. */
export const WITHHELD_VALUE = Object.freeze({ withheld: true as const });

/**
 * The record as an AUDIT ROW may hold it: every field of every SENSITIVE group the record carries is replaced by
 * `{ withheld: true }` (a null too -- "has a value" is itself information), and `sensitiveFieldsWithheld` names them.
 * Non-sensitive fields pass through unchanged, so the audit still says what happened to the record.
 */
export function auditSafe<T extends Record<string, unknown>>(def: ObjectFieldGroups, record: T | null): (Record<string, unknown> & { sensitiveFieldsWithheld: readonly string[] }) | null {
  if (record === null || record === undefined) return null;
  const out: Record<string, unknown> = { ...record };
  const names: string[] = [];
  for (const g of def.groups) {
    if (!g.sensitive) continue;
    for (const f of g.fields) {
      if (!Object.prototype.hasOwnProperty.call(out, f)) continue;
      out[f] = WITHHELD_VALUE;
      names.push(f);
    }
  }
  return Object.assign(out, { sensitiveFieldsWithheld: Object.freeze(names.sort()) });
}

/** The NAMES of the sensitive fields whose value differs between two records (for an audit reason) -- never the values. */
export function sensitiveFieldsChanged(def: ObjectFieldGroups, before: Record<string, unknown> | null, after: Record<string, unknown> | null): readonly string[] {
  const changed: string[] = [];
  for (const g of def.groups) {
    if (!g.sensitive) continue;
    for (const f of g.fields) {
      const b = before && Object.prototype.hasOwnProperty.call(before, f) ? JSON.stringify(before[f]) : undefined;
      const a = after && Object.prototype.hasOwnProperty.call(after, f) ? JSON.stringify(after[f]) : undefined;
      if (a !== b) changed.push(f);
    }
  }
  return Object.freeze(changed.sort());
}
