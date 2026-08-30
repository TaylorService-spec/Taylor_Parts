// EOS Ownership Model v1 — the CREATION OWNER resolver (Owner ruling D-4, 2026-08-30).
//
// One rule, in one place, for all three governed commercial creation paths:
//
//     explicit valid ownerEmployeeId  ->  use it
//     otherwise                       ->  inherit the governed upstream owner
//     neither resolves                ->  REFUSE
//
// Upstream is the Account owner for a new Opportunity, and the Opportunity owner for a new
// downstream commercial record.
//
// THE REFUSAL IS THE POINT. The ruling names six fallbacks that are all forbidden -- actor,
// createdBy, the authenticated user, assignedTo, an arbitrary salesperson, an admin, the first
// available employee -- and they are forbidden for one reason: every one of them would hand
// ownership to whoever happened to perform the action. That is the assistant case, and it is the
// case this model exists to get right:
//
//     Customer owner = Rudy. An assistant calls createOpportunity with no ownerEmployeeId.
//     Result: owner = Rudy, createdBy = the assistant.
//
// The caller does not acquire ownership merely by performing the action. So when nothing resolves,
// this throws rather than picking someone -- an unowned record the model can see is recoverable,
// a silently mis-owned one is not, because nothing downstream will ever flag it.
//
// PURE: no Firestore, no I/O. The caller reads the upstream document (inside its own transaction,
// so the inherited owner cannot drift between the read and the write) and hands the derivation in.

import { OWNER_TYPES, OWNERSHIP_RESOLUTION, type OwnerDerivation } from "./typedOwner";

export type CreationOwnerSource = "EXPLICIT" | "INHERITED";

export interface CreationOwnerResolution {
  ownerEmployeeId: string;
  source: CreationOwnerSource;
}

export class CreationOwnerUnresolvedError extends Error {
  readonly code = "OWNER_UNRESOLVED";
  constructor(message: string) {
    super(message);
    this.name = "CreationOwnerUnresolvedError";
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * @param explicitOwnerEmployeeId what the caller supplied, if anything. An absent, empty, or
 *        non-string value falls through to inheritance -- it is not an error on its own, which is
 *        what makes the relaxation backward-compatible: an existing caller that always supplies a
 *        real id never reaches the inheritance branch and behaves exactly as it did before.
 * @param upstreamOwner the derivation from the governed upstream record (deriveAccountOwner or
 *        deriveEmployeeRefOwner). Only a RESOLVED, USER-typed owner may be inherited: an
 *        AMBIGUOUS or UNRESOLVED upstream is precisely the case where guessing would be wrong.
 * @param context a short label naming the upstream, so the refusal message says which record
 *        failed to supply an owner rather than only that something did.
 */
export function resolveCreationOwner(
  explicitOwnerEmployeeId: unknown,
  upstreamOwner: OwnerDerivation | null | undefined,
  context: string,
): CreationOwnerResolution {
  if (nonEmpty(explicitOwnerEmployeeId)) {
    return { ownerEmployeeId: explicitOwnerEmployeeId.trim(), source: "EXPLICIT" };
  }

  if (
    upstreamOwner &&
    upstreamOwner.resolution === OWNERSHIP_RESOLUTION.RESOLVED &&
    upstreamOwner.owner !== null &&
    upstreamOwner.owner.type === OWNER_TYPES.USER
  ) {
    return { ownerEmployeeId: upstreamOwner.owner.id, source: "INHERITED" };
  }

  const why = upstreamOwner?.reason ?? upstreamOwner?.resolution ?? "no upstream owner supplied";
  throw new CreationOwnerUnresolvedError(
    `No owner: none was supplied and ${context} has no governed owner to inherit (${why}). ` +
      "Ownership is never assigned to the caller, the creator, or an arbitrary employee.",
  );
}
