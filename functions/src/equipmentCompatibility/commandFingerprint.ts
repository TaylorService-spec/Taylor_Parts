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
import { sha256Hex } from "./domain/compatibility";
import { OPERATION_ACTIONS, type OperationAction } from "./operations";

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

// Length-prefixed, type-tagged encoding. Length prefixes make it INJECTIVE: no value can be chosen so
// that two different field sets produce the same bytes, which a separator-joined encoding cannot
// promise (a separator character inside a string value would forge a boundary).
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
      // Length in UTF-16 code units, matching how the string is indexed here; the value follows
      // verbatim, so the decoder boundary is unambiguous regardless of its contents.
      return `s:${value.length}:${value}`;
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

// action + target opaque id + tuple hash (design §2). The payload is hashed first so the fingerprint
// stays bounded regardless of payload size, and the outer hash binds it to the action and target.
export function buildCommandFingerprint(input: {
  action: OperationAction;
  targetType: string;
  targetId: string;
  payload: unknown;
}): string {
  const { action, targetType, targetId, payload } = input ?? ({} as any);
  if (!(OPERATION_ACTIONS as readonly string[]).includes(action)) {
    throw new FingerprintContractError(`unknown action ${String(action)}`);
  }
  if (typeof targetType !== "string" || targetType.length === 0) throw new FingerprintContractError("targetType is required");
  if (typeof targetId !== "string" || targetId.length === 0) throw new FingerprintContractError("targetId is required");
  const tupleHash = sha256Hex(canonicalCommandPayload(action, payload));
  return sha256Hex([
    `v:${COMMAND_FINGERPRINT_VERSION}:`,
    encodeValue("action", action),
    encodeValue("targetType", targetType),
    encodeValue("targetId", targetId),
    encodeValue("tupleHash", tupleHash),
  ].join(""));
}
