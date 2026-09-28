// readMyCommercialCapabilities -- which Commercial controls the CALLER may be OFFERED, answered by the same PostgreSQL
// authority that authorizes the Commercial commands and reads (Pass 11 Retail Sales; the Workforce census finding #17
// pattern -- the Workforce readMyWorkforceCapabilities read -- applied to Commercial).
//
// WHY. The Opportunity / Sales Agreement / Sales Order screens decided which controls to offer from the Firebase
// effective-access feed (resolveEffectiveAccessCallable over Firestore users/roleAssignments) while every Commercial
// command and read is authorized by PostgreSQL (eos_policy.role_capabilities through resolveOperationalContext). The
// two could disagree -- and do for the canonical sales personas, whom the Firestore feed does not know -- so the
// salesperson who is authorized server-side was offered nothing. The offer now comes from the authority that decides.
//
// ONE SOURCE OF TRUTH. The transport has already resolved the caller (EOS Principal, ACTIVE membership, Roles,
// role_capabilities, grant conditions withheld) and hands this read that actor. Nothing is re-resolved here: the answer
// is `actor.capabilities` -- the exact set every Commercial command re-checks -- intersected with the closed list below.
//
// WHAT IT RETURNS. { capabilities: [...], channelScopedReads: [...] }
//   capabilities         held flat, in the closed list's order;
//   channelScopedReads   the three Commercial READ keys held ONLY within a sales-channel scope (lane GA). Such a reader
//                        may open the screens; the reads themselves filter to its channels. A scoped holding never
//                        appears in `capabilities`, so it can never be offered as a write.
// Nothing else: no Role, Principal, tenant, subject, channel list, or capability outside the list.
//
// CAPABILITY. None beyond an active Principal with an active membership (the read kernel checks both inside its
// read-only snapshot). It describes only the caller, accepts no selector, and confers nothing -- every command re-checks.
// NO NEW CAPABILITY: the list names existing Commercial ids only.
import { admittedScopeValues } from "../adminPolicy/assignmentScopeRuntime";
import { fail } from "./commands/commercialCommandKernel";
import { COMMERCIAL_READ_CAPABILITIES, runCommercialRead, type CommercialReadActor, type CommercialReadDeps } from "./reads/commercialReadKernel";

/** The closed list of Commercial capability ids a caller may learn it holds. Existing ids only. */
export const COMMERCIAL_OFFER_CAPABILITY_IDS = Object.freeze([
  "opportunity.read",
  "opportunity.write",
  "opportunity.createSalesOrder",
  "salesAgreement.read",
  "salesAgreement.create",
  "salesAgreement.updateDraft",
  "salesAgreement.accept",
  "salesOrder.read",
  "salesOrder.write",
] as const);

const READ_KEYS: readonly string[] = Object.freeze(Object.values(COMMERCIAL_READ_CAPABILITIES));

export interface MyCommercialCapabilities {
  readonly capabilities: readonly string[];
  readonly channelScopedReads: readonly string[];
}

export function readMyCommercialCapabilities(deps: CommercialReadDeps, actor: CommercialReadActor, input?: Record<string, unknown>): Promise<MyCommercialCapabilities> {
  return runCommercialRead(deps, actor, [],
    () => {
      const extra = input && typeof input === "object" ? Object.keys(input) : [];
      if (extra.length > 0) fail("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read accepts no input: ${extra.sort().join(", ")}`);
    },
    // Runs only after the kernel confirmed the active Principal + active membership in the snapshot.
    async () => ({
      capabilities: COMMERCIAL_OFFER_CAPABILITY_IDS.filter((id) => actor.capabilities.has(id)),
      channelScopedReads: READ_KEYS.filter((id) => !actor.capabilities.has(id) && admittedScopeValues(actor.scopedHeld, id, "salesChannel").length > 0),
    }));
}
