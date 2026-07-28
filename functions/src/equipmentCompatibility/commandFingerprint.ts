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
  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (nested.has(key)) {
      if (!isPlainObject(value)) throw new FingerprintContractError(`field ${key} must be a plain object`);
      for (const child of Object.keys(value)) paths.push(`${key}.${child}`);
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

// Run the payload through its applicable D1/D2 validator and report the identity it must be filed
// under. Only a NORMALIZED GOVERNED command gets a fingerprint: a payload the domain contract refuses
// has no command identity at all, and fingerprinting one would let an invalid command occupy an
// idempotency key. The VALIDATED value is what gets serialized, which also gives the normalization
// rule below its meaning.
function validatedCommand(action: OperationAction, payload: unknown, serialSchemes: Record<string, unknown>): { value: any; identity: string } {
  if (!isPlainObject(payload)) throw new FingerprintContractError("command payload must be a plain object");
  const fail = (reason: string): never => {
    throw new FingerprintContractError(`invalid ${action} payload: ${reason}`);
  };
  // The D1/D2 validators read fields with plain property access, which walks the prototype chain, while
  // their unknown-field checks use own keys. A polluted Object.prototype could therefore inject a value
  // for an optional governed field and change a command's identity without that field ever appearing on
  // the payload. Refuse any declared field that is reachable ONLY through the prototype. A field that is
  // simply absent is still allowed here — the domain contract decides whether it is derivable.
  const declared = Object.prototype.hasOwnProperty.call(COMMAND_FINGERPRINT_FIELDS, action)
    ? COMMAND_FINGERPRINT_FIELDS[action]
    : [];
  for (const path of declared) {
    const root = path.includes(".") ? path.slice(0, path.indexOf(".")) : path;
    if (root in payload && !Object.prototype.hasOwnProperty.call(payload, root)) {
      throw new FingerprintContractError(`field ${root} is inherited, not an own property of the command payload`);
    }
  }
  switch (action) {
    case "importEquipmentModel": {
      const v = validateEquipmentModel(payload);
      if (!v.valid) fail(v.reason);
      return { value: v.value, identity: v.value.equipmentModelId };
    }
    case "importEquipmentModelAlias": {
      // The governed VALUE carries `aliasValue`; the D1 validator takes it as `rawValue`.
      const v = validateEquipmentModelAlias({
        aliasType: payload.aliasType, manufacturerId: payload.manufacturerId, rawValue: payload.aliasValue,
        equipmentModelId: payload.equipmentModelId, aliasKey: payload.aliasKey,
      });
      if (!v.valid) fail(v.reason);
      return { value: v.value, identity: v.value.aliasKey };
    }
    case "importCompatibility":
    case "correctCompatibility": {
      const v = validateCompatibility(payload, { serialSchemes });
      if (!v.valid) fail(v.reason);
      return { value: v.value, identity: v.value.compatibilityId };
    }
    case "importCompatibilitySource": {
      const v = validateCompatibilitySource(payload);
      if (!v.valid) fail(v.reason);
      return { value: v.value, identity: v.value.sourceId };
    }
    case "verifyCompatibility": {
      // An explicit command shape, not a domain record: strictly validated here.
      const keys = Object.keys(payload);
      if (keys.length !== 2 || !keys.includes("compatibilityId") || !keys.includes("verificationStatus")) {
        fail("expected exactly { compatibilityId, verificationStatus }");
      }
      if (!isCanonicalCompatibilityId(payload.compatibilityId)) fail("compatibility_id_invalid");
      const verificationStatus = normalizeIdentityKey(payload.verificationStatus);
      if (!VERIFICATION_STATES.includes(verificationStatus)) fail("verification_status_invalid");
      return {
        value: { compatibilityId: payload.compatibilityId, verificationStatus },
        identity: payload.compatibilityId as string,
      };
    }
    default:
      throw new FingerprintContractError(`unknown action ${String(action)}`);
  }
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
  const { action, targetType, targetId, payload, serialSchemes } = input ?? ({} as any);
  if (!(OPERATION_ACTIONS as readonly string[]).includes(action)) {
    throw new FingerprintContractError(`unknown action ${String(action)}`);
  }
  const expectedTargetType = ACTION_TARGET_TYPES[action];
  if (targetType !== expectedTargetType) {
    throw new FingerprintContractError(`action ${action} targets ${expectedTargetType}, not ${String(targetType)}`);
  }
  if (typeof targetId !== "string" || targetId.length === 0) throw new FingerprintContractError("targetId is required");
  const { value, identity } = validatedCommand(action, payload, serialSchemes ?? {});
  if (targetId !== identity) {
    throw new FingerprintContractError(`targetId ${targetId} does not match the payload identity ${identity}`);
  }
  const tupleHash = sha256Hex(canonicalCommandPayload(action, value));
  return sha256Hex([
    `v:${COMMAND_FINGERPRINT_VERSION}:`,
    encodeValue("action", action),
    encodeValue("targetType", targetType),
    encodeValue("targetId", targetId),
    encodeValue("tupleHash", tupleHash),
  ].join(""));
}
