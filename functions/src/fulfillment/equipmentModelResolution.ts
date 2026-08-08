// Fulfillment — PURE ordered-model ↔ eligible-serial resolution (Owner Decision, Option A). Given an ordered
// EQUIPMENT_MODEL line ref, resolve it to a canonical equipmentModelId (alias-aware, NEVER a value-join over
// free-text manufacturer/model), then to the eligible WHOLE-UNIT Parts (Part.wholeUnit === true AND
// Part.equipmentModelId === the model AND ACTIVE), then to their serialized-asset candidates. This is the
// mapping the equipment-availability contract was blocked on; it does NOT decide availability (that still
// requires the ratified evidence + the not-yet-connected serialized-asset availability signal). No I/O.

import { isCanonicalEquipmentModelId } from "../equipmentCompatibility/domain/equipmentModel";

export interface WholeUnitPartLike {
  partId: string;
  status?: string;
  wholeUnit?: boolean;
  equipmentModelId?: string;
}

export type ModelRefResolution =
  | { resolved: true; equipmentModelId: string; via: "CANONICAL" | "ALIAS" }
  | { resolved: false; reason: "UNRESOLVED_ALIAS" | "UNRESOLVED_NO_RESOLVER" | "INVALID_REF" };

// Resolve an ordered EQUIPMENT_MODEL ref → canonical equipmentModelId. If the ref is already a canonical id, use
// it directly; otherwise defer to the governed equipment-model ALIAS resolver (deps.resolveAlias), which maps an
// alternate model identifier to its canonical id. Absent a resolver (or an unresolved alias) ⇒ UNRESOLVED — we
// NEVER fabricate a model id from free text (Owner §1).
export function resolveOrderedModelRef(
  ref: unknown,
  deps: { resolveAlias?: (rawRef: string) => string | null } = {},
): ModelRefResolution {
  if (typeof ref !== "string" || ref.trim().length === 0) return { resolved: false, reason: "INVALID_REF" };
  const trimmed = ref.trim();
  if (isCanonicalEquipmentModelId(trimmed)) return { resolved: true, equipmentModelId: trimmed, via: "CANONICAL" };
  if (typeof deps.resolveAlias !== "function") return { resolved: false, reason: "UNRESOLVED_NO_RESOLVER" };
  const aliased = deps.resolveAlias(trimmed);
  if (typeof aliased === "string" && isCanonicalEquipmentModelId(aliased)) {
    return { resolved: true, equipmentModelId: aliased, via: "ALIAS" };
  }
  return { resolved: false, reason: "UNRESOLVED_ALIAS" };
}

// Eligible WHOLE-UNIT Parts for a model: wholeUnit === true AND equipmentModelId === the model AND ACTIVE.
// ONE model → MANY eligible Parts (revisions/variants). Returns distinct partIds in stable order. A Part that
// merely references the model via equipment_compatibility (service parts) is NOT here — only the governed
// whole-unit FK qualifies (Owner §4).
export function resolveEligibleWholeUnitParts(equipmentModelId: string, parts: WholeUnitPartLike[]): string[] {
  if (!isCanonicalEquipmentModelId(equipmentModelId)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(parts) ? parts : []) {
    if (p?.wholeUnit === true && p.equipmentModelId === equipmentModelId && p.status === "ACTIVE") {
      const id = typeof p.partId === "string" ? p.partId : null;
      if (id && !seen.has(id)) { seen.add(id); out.push(id); }
    }
  }
  return out;
}

// The serialized-asset CANDIDATES for a model = the serials keyed to any eligible whole-unit partId. These are
// candidates BEFORE the availability predicate (company control / eligible location / no conflicting allocation
// or custody / temp-placement / readiness) — resolving them is the mapping's job, deciding availability is the
// contract's. Returns distinct serials in stable (partId, serial) order.
export function resolveWholeUnitSerialCandidates(
  equipmentModelId: string,
  input: { parts: WholeUnitPartLike[]; serialsByPartId: Record<string, string[]> },
): string[] {
  const partIds = resolveEligibleWholeUnitParts(equipmentModelId, input?.parts ?? []);
  const map = input?.serialsByPartId ?? {};
  const out: string[] = [];
  const seen = new Set<string>();
  for (const partId of partIds) {
    for (const serial of Array.isArray(map[partId]) ? map[partId] : []) {
      if (typeof serial === "string" && serial.length > 0 && !seen.has(serial)) { seen.add(serial); out.push(serial); }
    }
  }
  return out;
}
