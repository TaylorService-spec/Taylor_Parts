// D4 Stage C.1 — the governed command fingerprint contract.
//
// The fingerprint is what makes a reused idempotencyKey safe: an EXACT replay of the same governed
// command is a no-op success, and a key reused with different command data fails closed. Its shape is
// the design package's — action + target opaque id + tuple hash (§2) — and it is a SEPARATELY GOVERNED
// serialization, not a convenience hash.
//
// Deliberately NOT JSON.stringify(validatedValue):
//   - JSON property order follows insertion order, so two equal commands built in different field
//     orders would fingerprint differently and a legitimate replay would fail closed;
//   - `undefined` and missing keys silently vanish, so an omitted field and an explicit null collapse
//     into the same bytes;
//   - a field added to a domain value later would silently change every existing command's identity,
//     retroactively invalidating stored operation records.
// Instead each action declares an EXPLICIT, ORDERED field list here. Ordering is part of the contract
// and never depends on object property order. An input carrying a field the list does not name is
// REJECTED rather than ignored, so a new domain field cannot enter the fingerprint unnoticed — adding
// one is a deliberate edit to this file and, if identities must stay stable, a version bump.
//
// D2's sha256Hex is used ONLY as the hashing primitive; the serialization is defined here.
import {
  isCanonicalCompatibilityId, sha256Hex, validateCompatibility, validateCompatibilitySource,
  VERIFICATION_STATES,
} from "./domain/compatibility";
import { normalizeIdentityKey, validateEquipmentModel, validateEquipmentModelAlias } from "./domain/equipmentModel";
import { ACTION_TARGET_TYPES, OPERATION_ACTIONS, type OperationAction } from "./operations";

// Bump ONLY with a deliberate decision: it changes every command identity, so previously stored
// operation records would no longer match a replay of the same logical command.
export const COMMAND_FINGERPRINT_VERSION = 1;

export class FingerprintContractError extends Error {}

// The exact, ordered governed fields per action. Nested values are addressed by explicit dotted paths —
// there is no recursive walk, so nothing can be picked up implicitly.
const COMPATIBILITY_FIELDS = [
  "compatibilityId", "uniquenessKey", "equipmentModelId", "partId", "compatibilityType",
  "assembly", "installationPosition", "quantityRequired",
  "applicability.kind", "applicability.serialScheme", "applicability.serialRangeStart",
  "applicability.serialRangeEnd", "applicability.modelRevision",
  "effectiveFrom", "effectiveTo", "sourceSummary", "confidenceLevel", "verificationStatus",
  "notes", "version",
] as const;

export const COMMAND_FINGERPRINT_FIELDS: Readonly<Record<OperationAction, readonly string[]>> = Object.freeze({
  importEquipmentModel: Object.freeze([
    "equipmentModelId", "manufacturerId", "manufacturerName", "modelNumber", "displayName",
    "family", "subtype", "revision", "status", "sourceAuthority", "version",
  ]),
  importEquipmentModelAlias: Object.freeze([
    "aliasKey", "aliasType", "manufacturerId", "aliasValue", "equipmentModelId",
  ]),
  importCompatibility: Object.freeze([...COMPATIBILITY_FIELDS]),
  // A correction restates the whole governed relationship, so it fingerprints the same field set.
  correctCompatibility: Object.freeze([...COMPATIBILITY_FIELDS]),
  importCompatibilitySource: Object.freeze([
    "sourceId", "compatibilityId", "authorityType", "sourceReference", "sourceVersion",
    "observedClaim", "contentFingerprint", "capturedAt", "capturedBy", "notes",
  ]),
  // A verification changes only the governed verification outcome on an existing relationship.
  verifyCompatibility: Object.freeze(["compatibilityId", "verificationStatus"]),
});

// THE ACCEPTED UNICODE DOMAIN: well-formed UTF-16 only — no unpaired surrogate, anywhere.
//
// This is not stylistic. The canonical string is hashed as UTF-8, and UTF-8 encoding replaces every
// unpaired surrogate with U+FFFD, so "\uD800" and "\uD801" become identical bytes. A UTF-16 code-unit
// length prefix cannot separate them either, since both are one code unit. Distinct strings would then
// share a fingerprint, which for a command identity means two different commands colliding. Ill-formed
// strings are therefore REJECTED before hashing rather than silently mangled.
//
// Scanned explicitly rather than via String.prototype.isWellFormed or a lookbehind regex, so the
// contract does not depend on a runtime feature level.
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (low < 0xdc00 || low > 0xdfff) return true; // high surrogate not followed by a low one
      i++; // valid pair
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true; // low surrogate with no preceding high one
    }
  }
  return false;
}

const UTF8 = new TextEncoder();
const utf8ByteLength = (s: string): number => UTF8.encode(s).length;

// Length-prefixed, type-tagged encoding. Length prefixes make it INJECTIVE: no value can be chosen so
// that two different field sets produce the same bytes, which a separator-joined encoding cannot
// promise (a separator character inside a string value would forge a boundary). The string prefix is
// the UTF-8 BYTE length — the unit the hash actually consumes — so the boundary the prefix declares is
// the boundary the hasher sees.
function encodeValue(path: string, value: unknown): string {
  if (value === null) return "n:";
  switch (typeof value) {
    case "boolean":
      return value ? "b:1" : "b:0";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new FingerprintContractError(`field ${path} must be a safe integer, got ${String(value)}`);
      }
      return `i:${value}:`;
    case "string":
      if (hasLoneSurrogate(value)) {
        throw new FingerprintContractError(`field ${path} contains an unpaired surrogate and is not well-formed Unicode`);
      }
      return `s:${utf8ByteLength(value)}:${value}`;
    default:
      throw new FingerprintContractError(`field ${path} has unsupported type ${typeof value}`);
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));

// Collect the own keys a payload actually carries, as dotted paths one level deep for the nested
// objects the field lists reference. Anything deeper is not part of any contract and is rejected.
function ownPaths(payload: Record<string, unknown>, nested: ReadonlySet<string>): string[] {
  const paths: string[] = [];
  if (Object.getOwnPropertySymbols(payload).length > 0) {
    throw new FingerprintContractError("command payload carries own symbol keys, which are not governed fields");
  }
  // getOwnPropertyNames, not Object.keys: a non-enumerable own key is still an own key.
  for (const key of Object.getOwnPropertyNames(payload)) {
    const value = payload[key];
    if (nested.has(key)) {
      if (!isPlainObject(value)) throw new FingerprintContractError(`field ${key} must be a plain object`);
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new FingerprintContractError(`field ${key} carries own symbol keys`);
      }
      for (const child of Object.getOwnPropertyNames(value)) paths.push(`${key}.${child}`);
      continue;
    }
    paths.push(key);
  }
  return paths;
}

function readPath(payload: Record<string, unknown>, path: string): unknown {
  const dot = path.indexOf(".");
  if (dot < 0) {
    if (!Object.prototype.hasOwnProperty.call(payload, path)) {
      throw new FingerprintContractError(`missing governed field ${path}`);
    }
    return payload[path];
  }
  const parent = payload[path.slice(0, dot)];
  if (!isPlainObject(parent)) throw new FingerprintContractError(`field ${path.slice(0, dot)} must be a plain object`);
  const child = path.slice(dot + 1);
  if (!Object.prototype.hasOwnProperty.call(parent, child)) {
    throw new FingerprintContractError(`missing governed field ${path}`);
  }
  return parent[child];
}

// The canonical serialization of a command payload: every declared field, in the declared order, each
// encoded with its path so a value cannot migrate between fields unnoticed.
export function canonicalCommandPayload(action: OperationAction, payload: unknown): string {
  const fields = Object.prototype.hasOwnProperty.call(COMMAND_FINGERPRINT_FIELDS, action)
    ? COMMAND_FINGERPRINT_FIELDS[action]
    : undefined;
  if (fields === undefined) throw new FingerprintContractError(`unknown action ${String(action)}`);
  if (!isPlainObject(payload)) throw new FingerprintContractError("command payload must be a plain object");

  const nested = new Set(fields.filter((f) => f.includes(".")).map((f) => f.slice(0, f.indexOf("."))));
  const declared = new Set<string>(fields);
  // Fail closed on ANY field the contract does not name — an unrecognised field must never be silently
  // excluded from the identity of a command.
  for (const path of ownPaths(payload, nested)) {
    if (!declared.has(path)) throw new FingerprintContractError(`unexpected field ${path} for action ${action}`);
  }
  const parts: string[] = [`v:${COMMAND_FINGERPRINT_VERSION}:`, encodeValue("action", action)];
  for (const path of fields) {
    parts.push(encodeValue(path, path), encodeValue(path, readPath(payload, path)));
  }
  return parts.join("");
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// Split the declared paths into the top-level field set and, per nested governed object, its allowed
// child set. This is the whole schema — there is no other place a field can be declared.
function declaredSchema(action: OperationAction): { topLevel: Set<string>; nested: Map<string, Set<string>> } {
  const fields = hasOwn(COMMAND_FINGERPRINT_FIELDS, action) ? COMMAND_FINGERPRINT_FIELDS[action] : undefined;
  if (fields === undefined) throw new FingerprintContractError(`unknown action ${String(action)}`);
  const topLevel = new Set<string>();
  const nested = new Map<string, Set<string>>();
  for (const path of fields) {
    const dot = path.indexOf(".");
    if (dot < 0) {
      topLevel.add(path);
      continue;
    }
    const root = path.slice(0, dot);
    topLevel.add(root);
    if (!nested.has(root)) nested.set(root, new Set());
    nested.get(root)!.add(path.slice(dot + 1));
  }
  return { topLevel, nested };
}

// The strict own-property schema gate, applied to the ORIGINAL action-specific payload.
//
// It runs BEFORE any D1/D2 validator and before any adapter reconstruction. That ordering is the whole
// point: the alias path has to hand D1 a `rawValue` where the governed value carries `aliasValue`, and
// a reconstruction that copies named properties would silently drop an unknown field — the field would
// then leave the command identity without anyone rejecting it.
//
// Three distinct states per declared path, deliberately not collapsed:
//   OWN           — present and honest; the domain contract validates it;
//   ABSENT        — allowed here; the domain contract decides whether it is derivable (D1 rebuilds
//                   equipmentModelId from manufacturerId + modelNumber, for example);
//   PROTOTYPE-ONLY — always rejected. The D1/D2 validators read fields with plain property access, so
//                   an inherited value would be read as real while their own-key unknown-field checks
//                   never see it. Checked at EVERY level, not just the root: an inherited
//                   applicability.modelRevision is exactly as dangerous as an inherited top-level one.
// Check ONE governed data map: every own string key must be declared, no own symbols, and every own
// property must be a plain data property. Object.keys() is deliberately not used — it sees only
// ENUMERABLE string keys, so a non-enumerable `hiddenFuture` or an own Symbol would slip past an
// "unknown field" check that claims to be exhaustive.
//
// Accessors are REJECTED rather than snapshotted. A governed command payload is data, not behaviour:
// a getter could return one value to the validator and another to the serializer, so the command that
// was authorized would not be the command that was fingerprinted. Descriptors are inspected, never
// invoked, so a throwing getter is refused without ever running.
function assertGovernedMap(label: string, value: unknown, declared: ReadonlySet<string>): Record<string, unknown> {
  if (!isPlainObject(value)) throw new FingerprintContractError(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new FingerprintContractError(`${label} carries own symbol keys, which are not governed fields`);
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!declared.has(key)) throw new FingerprintContractError(`unexpected field ${label === "command payload" ? key : `${label}.${key}`}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      throw new FingerprintContractError(`field ${key} on ${label} is an accessor; governed command fields must be plain data`);
    }
  }
  for (const key of declared) {
    if (key in value && !hasOwn(value, key)) {
      throw new FingerprintContractError(`field ${key} on ${label} is inherited, not an own property`);
    }
  }
  return value;
}

function assertCommandPayloadSchema(action: OperationAction, payload: unknown): Record<string, unknown> {
  const { topLevel, nested } = declaredSchema(action);
  const record = assertGovernedMap("command payload", payload, topLevel);
  for (const [root, children] of nested) {
    if (!hasOwn(record, root)) continue; // genuinely absent — the domain contract decides
    assertGovernedMap(root, record[root], children);
  }
  return record;
}

// ---------------------------------------------------------------------------
// The serial-scheme registry is an untrusted governed DEPENDENCY, not payload
// ---------------------------------------------------------------------------
// D2 resolves a scheme with ordinary property access, so an inherited registry entry would authorize
// and fingerprint a SERIAL_RANGE command that the caller's own registry never contained. The registry
// is therefore held to the same boundary as the payload, and D2 is handed a DETACHED null-prototype
// map carrying only the one validated scheme the command actually asked for — nothing else is reachable.
const SERIAL_SCHEME_FIELDS: ReadonlySet<string> = new Set(["schemeId", "manufacturerId", "normalizerVersion", "tokenPattern", "ordering"]);

function detachedSerialSchemes(record: Record<string, unknown>, serialSchemes: unknown): Record<string, unknown> {
  const detached: Record<string, unknown> = Object.create(null);
  if (serialSchemes === undefined || serialSchemes === null) return detached;
  if (!isPlainObject(serialSchemes)) throw new FingerprintContractError("serialSchemes must be a plain object");
  if (Object.getOwnPropertySymbols(serialSchemes).length > 0) {
    throw new FingerprintContractError("serialSchemes carries own symbol keys");
  }
  const applicability = record.applicability;
  if (!isPlainObject(applicability)) return detached; // the domain contract will reject the shape
  const requested = normalizeIdentityKey(applicability.serialScheme);
  if (!requested) return detached; // no scheme requested; D2 decides whether that is legal
  if (requested in serialSchemes && !hasOwn(serialSchemes, requested)) {
    throw new FingerprintContractError(`serial scheme ${requested} is inherited, not an own registry entry`);
  }
  if (!hasOwn(serialSchemes, requested)) return detached; // genuinely absent → D2 reports it unresolved
  const descriptor = Object.getOwnPropertyDescriptor(serialSchemes, requested)!;
  if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
    throw new FingerprintContractError(`serial scheme ${requested} is an accessor; the registry must be plain data`);
  }
  const scheme = assertGovernedMap(`serial scheme ${requested}`, serialSchemes[requested], SERIAL_SCHEME_FIELDS);
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of SERIAL_SCHEME_FIELDS) {
    if (!hasOwn(scheme, key)) throw new FingerprintContractError(`serial scheme ${requested} is missing ${key}`);
    const value = scheme[key];
    // Scheme fields are primitives by contract; anything else would be a mutable dependency in disguise.
    if (value !== null && typeof value === "object") {
      throw new FingerprintContractError(`serial scheme ${requested}.${key} must be a primitive`);
    }
    copy[key] = value;
  }
  // DEEP-frozen: the exported PreparedCommand must not hand back a mutable validation dependency, so the
  // selected scheme object is frozen as well as the map that holds it.
  detached[requested] = Object.freeze(copy);
  return detached;
}

// Run the payload through its applicable D1/D2 validator and report the identity it must be filed
// under. Only a NORMALIZED GOVERNED command gets a fingerprint: a payload the domain contract refuses
// has no command identity at all, and fingerprinting one would let an invalid command occupy an
// idempotency key. The VALIDATED value is what gets serialized, which also gives the normalization
// rule below its meaning.
function validatedCommand(action: OperationAction, payload: unknown, detachedSchemes: Record<string, unknown>): { value: any; identity: string } {
  // STRICT BOUNDARY FIRST — before any validator call and before any adapter reconstruction, because
  // an adapter that copies selected properties would drop an unknown field before the domain contract
  // could object to it.
  const record = assertCommandPayloadSchema(action, payload);
  const fail = (reason: string): never => {
    throw new FingerprintContractError(`invalid ${action} payload: ${reason}`);
  };
  switch (action) {
    case "importEquipmentModel": {
      const v = validateEquipmentModel(record);
      if (!v.valid) fail(v.reason);
      return { value: v.value, identity: v.value.equipmentModelId };
    }
    case "importEquipmentModelAlias": {
      // The governed VALUE carries `aliasValue`; the D1 validator takes it as `rawValue`.
      const v = validateEquipmentModelAlias({
        aliasType: record.aliasType, manufacturerId: record.manufacturerId, rawValue: record.aliasValue,
        equipmentModelId: record.equipmentModelId, aliasKey: record.aliasKey,
      });
      if (!v.valid) fail(v.reason);
      return { value: v.value, identity: v.value.aliasKey };
    }
    case "importCompatibility":
    case "correctCompatibility": {
      // D2 only ever sees the detached, own-property-validated registry.
      const v = validateCompatibility(record, { serialSchemes: detachedSchemes });
      if (!v.valid) fail(v.reason);
      return { value: v.value, identity: v.value.compatibilityId };
    }
    case "importCompatibilitySource": {
      const v = validateCompatibilitySource(record);
      if (!v.valid) fail(v.reason);
      return { value: v.value, identity: v.value.sourceId };
    }
    case "verifyCompatibility": {
      // An explicit command shape, not a domain record: strictly validated here.
      const keys = Object.getOwnPropertyNames(record);
      if (keys.length !== 2 || !keys.includes("compatibilityId") || !keys.includes("verificationStatus")) {
        fail("expected exactly { compatibilityId, verificationStatus }");
      }
      if (!isCanonicalCompatibilityId(record.compatibilityId)) fail("compatibility_id_invalid");
      const verificationStatus = normalizeIdentityKey(record.verificationStatus);
      if (!VERIFICATION_STATES.includes(verificationStatus)) fail("verification_status_invalid");
      return {
        value: { compatibilityId: record.compatibilityId, verificationStatus },
        identity: record.compatibilityId as string,
      };
    }
    default:
      throw new FingerprintContractError(`unknown action ${String(action)}`);
  }
}

// A PREPARED COMMAND: the single governed value that validation, fingerprinting and persistence all
// use. Returned as one object so there is no window in which the caller's payload can change between
// being fingerprinted and being written -- the caller's object is never consulted again.
export interface PreparedCommand {
  readonly action: OperationAction;
  readonly targetType: string;
  readonly targetId: string;
  // The NORMALIZED governed value from the applicable D1/D2 validator, deep-frozen and detached from
  // the caller (the validators already build fresh objects; this makes that guarantee explicit and
  // enforced rather than incidental).
  readonly value: Record<string, unknown>;
  // The detached null-prototype registry that was ACTUALLY used to validate this command. Persistence
  // must re-validate against exactly this, never against a caller-held registry that may have changed.
  readonly serialSchemes: Record<string, unknown>;
  readonly fingerprint: string;
}

// Deep-freeze a governed value. The declared field types are primitives, null and plain nested objects,
// so anything else is not a governed value and is refused rather than silently frozen.
function deepFreezeGovernedValue(path: string, value: unknown): unknown {
  if (value === null) return value;
  const kind = typeof value;
  if (kind === "boolean" || kind === "number" || kind === "string") return value;
  if (!isPlainObject(value)) throw new FingerprintContractError(`prepared value ${path} has unsupported type`);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreezeGovernedValue(`${path}.${key}`, value[key]);
  }
  return Object.freeze(value);
}

// action + target opaque id + tuple hash (design §2). The payload is hashed first so the fingerprint
// stays bounded regardless of payload size, and the outer hash binds it to the action and target.
//
// NORMALIZATION RULE (explicit, and the reason two spellings can share an identity): the serialized
// input is the VALIDATED value, so any two inputs the D1/D2 contracts normalize to the same governed
// value produce the SAME fingerprint — `status: "active"` and `status: "ACTIVE"` are one command, not
// two. Anything the contracts refuse produces no fingerprint at all. The normalization applied is
// exactly D1/D2's and no more: normalizeIdentityText applies NFKC, so decomposed, composed and
// compatibility-equivalent spellings of governed text are ONE command by governed decision. This
// module adds no normalization of its own -- it serializes what the domain contracts declare canonical.
//
// COHERENCE: the action fixes the targetType (ACTION_TARGET_TYPES), and targetId must equal the
// identity the validated payload derives — equipmentModelId, aliasKey, compatibilityId or sourceId as
// applicable. There is exactly one place action, target and payload identity can agree, and disagreement
// is refused rather than hashed.
export function buildCommandFingerprint(input: {
  action: OperationAction;
  targetType: string;
  targetId: string;
  payload: unknown;
  serialSchemes?: Record<string, unknown>;
}): string {
  return prepareCommand(input).fingerprint;
}

// The one entry point that turns caller input into a governed command. Everything downstream — the
// operation record's fingerprint AND the record actually persisted — comes from the result.
export function prepareCommand(input: {
  action: OperationAction;
  targetType: string;
  targetId: string;
  payload: unknown;
  serialSchemes?: unknown;
}): PreparedCommand {
  const { action, targetType, targetId, payload, serialSchemes } = input ?? ({} as any);
  if (!(OPERATION_ACTIONS as readonly string[]).includes(action)) {
    throw new FingerprintContractError(`unknown action ${String(action)}`);
  }
  const expectedTargetType = ACTION_TARGET_TYPES[action];
  if (targetType !== expectedTargetType) {
    throw new FingerprintContractError(`action ${action} targets ${expectedTargetType}, not ${String(targetType)}`);
  }
  if (typeof targetId !== "string" || targetId.length === 0) throw new FingerprintContractError("targetId is required");
  // The registry is detached ONCE here; both validation and the returned PreparedCommand use that same
  // detached copy, so a later mutation of the caller's registry cannot change what persistence sees.
  const detachedSchemes = detachedSerialSchemes(assertCommandPayloadSchema(action, payload), serialSchemes);
  const { value, identity } = validatedCommand(action, payload, detachedSchemes);
  if (targetId !== identity) {
    throw new FingerprintContractError(`targetId ${targetId} does not match the payload identity ${identity}`);
  }
  const tupleHash = sha256Hex(canonicalCommandPayload(action, value));
  const fingerprint = sha256Hex([
    `v:${COMMAND_FINGERPRINT_VERSION}:`,
    encodeValue("action", action),
    encodeValue("targetType", targetType),
    encodeValue("targetId", targetId),
    encodeValue("tupleHash", tupleHash),
  ].join(""));
  deepFreezeGovernedValue("value", value);
  return Object.freeze({ action, targetType, targetId, value, serialSchemes: Object.freeze(detachedSchemes), fingerprint });
}
