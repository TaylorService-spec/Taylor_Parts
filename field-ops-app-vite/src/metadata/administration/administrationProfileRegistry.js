// THE OBJECT ADMINISTRATION PROFILE REGISTRY — every profile, in one place.
//
// Deliberately the SAME shape as `metadata/entityRegistry.js`: explicit imports, one frozen array,
// and a coverage test that fails when a profile file exists and nobody imported it. A clever
// auto-discovering version was considered and refused — the entity registry's hand-maintained list
// is what makes "which objects exist" reviewable in a diff, and a glob would make adding an
// administered object invisible to review.
//
// ════════════════════ ONE PROFILE, ONE ENTITY, NO SECOND MODEL ════════════════════
//
// A profile never carries fields of its own. `validateAdministrationProfileRegistry` resolves every
// profile's `entityId` against ENTITY_REGISTRY and checks every fieldId it names against that
// entity's declared fields, so the two lists cannot drift into describing different objects.
//
// AN ENTITY WITHOUT A PROFILE IS NORMAL, NOT AN ERROR. Twenty-nine entities are registered and the
// profiles arrive object by object as each one's authority is actually traced. `unprofiledEntities()`
// reports the remainder so the gap is COUNTABLE rather than invisible — which is the difference
// between a migration in progress and a screen that quietly shows less than it should.
import { ENTITY_REGISTRY, findEntityById } from "../entityRegistry.js";
import {
  validateObjectAdministrationProfile,
  validateProfileAgainstEntity,
} from "./objectAdministrationProfile.js";
import { invoiceAdministrationProfile } from "./profiles/invoice.js";
import { partAdministrationProfile } from "./profiles/part.js";
import { paymentAdministrationProfile } from "./profiles/payment.js";

/** Every declared profile, alphabetically by entity id so a screen has a stable order. */
export const ADMINISTRATION_PROFILES = Object.freeze([
  invoiceAdministrationProfile,
  partAdministrationProfile,
  paymentAdministrationProfile,
]);

/** One profile by the entity it governs, or null. An unknown id is a question, not a fault. */
export const findAdministrationProfile = (entityId) =>
  ADMINISTRATION_PROFILES.find((profile) => profile.entityId === entityId) ?? null;

/** Whether an object has an administration profile at all — what a screen asks before rendering one. */
export const hasAdministrationProfile = (entityId) => findAdministrationProfile(entityId) !== null;

/**
 * Registered entities with no profile yet.
 *
 * Reported, never inferred-around. A surface that silently rendered an empty panel for these would
 * make "nobody has traced this object's authority" look identical to "this object has no rules".
 */
export const unprofiledEntities = () =>
  Object.freeze(ENTITY_REGISTRY.filter((entity) => !hasAdministrationProfile(entity.id)));

/**
 * Validate the whole registry: each profile on its own, then against the entity it governs, then
 * the cross-profile rule that one entity is administered by exactly one profile.
 *
 * Returns problem strings; empty means valid. It does not throw — the test decides what a problem
 * costs, the same division `validateEntityRegistry` already uses.
 */
export function validateAdministrationProfileRegistry(profiles = ADMINISTRATION_PROFILES) {
  const problems = [];
  const seen = new Set();

  for (const profile of profiles) {
    if (profile?.entityId) {
      if (seen.has(profile.entityId)) {
        problems.push(`entity ${profile.entityId} has more than one administration profile`);
      }
      seen.add(profile.entityId);
    }
    problems.push(...validateObjectAdministrationProfile(profile));
    problems.push(...validateProfileAgainstEntity(profile, findEntityById(profile?.entityId)));
  }

  return problems;
}

/** Totals, for a coverage ledger and for a screen that wants to say how much of the model it covers. */
export const administrationProfileCounts = () => ({
  entities: ENTITY_REGISTRY.length,
  profiled: ADMINISTRATION_PROFILES.length,
  unprofiled: unprofiledEntities().length,
  fieldPolicies: ADMINISTRATION_PROFILES.reduce((n, p) => n + p.fieldPolicies.length, 0),
  commands: ADMINISTRATION_PROFILES.reduce((n, p) => n + p.commands.length, 0),
});
