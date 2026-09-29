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
// WHAT IT RETURNS. { capabilities: [...], channelScoped: [...] }
//   capabilities    held flat (every channel), in the closed list's order;
//   channelScoped   the Commercial keys held ONLY within a sales-channel scope (lane GA reads; DQ-020 writes). Such a
//                   caller may be offered the control; every read filters, and every command decides, against the
//                   record's own channel -- so the offer never widens anything.
// Nothing else: no Role, Principal, tenant, subject, channel list, or capability outside the list.
//
// CAPABILITY. None beyond an active Principal with an active membership (the read kernel checks both inside its
// read-only snapshot). It describes only the caller, accepts no selector, and confers nothing -- every command re-checks.
// NO NEW CAPABILITY: the list names existing Commercial ids only.
import { admittedScopeValues } from "../adminPolicy/assignmentScopeRuntime";
import { fail } from "./commands/commercialCommandKernel";
import { runCommercialRead, type CommercialReadActor, type CommercialReadDeps } from "./reads/commercialReadKernel";

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


export interface MyCommercialCapabilities {
  readonly capabilities: readonly string[];
  readonly channelScoped: readonly string[];
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
      channelScoped: COMMERCIAL_OFFER_CAPABILITY_IDS.filter((id) => !actor.capabilities.has(id) && admittedScopeValues(actor.scopedHeld, id, "salesChannel").length > 0),
    }));
}
