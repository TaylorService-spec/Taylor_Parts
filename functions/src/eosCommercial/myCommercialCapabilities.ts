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
// WHAT IT RETURNS. { capabilities: [...], channelScoped: [...], channelOffers: {...} }
//   capabilities    held flat (every channel), in the closed list's order;
//   channelScoped   the Commercial keys held ONLY within a sales-channel scope (lane GA reads; DQ-020 writes). Such a
//                   caller may be offered the control; every read filters, and every command decides, against the
//                   record's own channel -- so the offer never widens anything.
//   channelOffers   AUTHORIZED CHANNELS ONLY (Controller DQ-4, 2026-09-30): for each Commercial write in which the caller
//                   CHOOSES a channel (CHANNEL_CHOOSING_CAPABILITY_IDS), the channels THIS caller may choose -- the
//                   tenant's ACTIVE channels, narrowed to the caller's own salesChannel scope values when the key is held
//                   only scoped; a flat holding admits every ACTIVE channel; no holding admits none. Derived from the
//                   caller's resolved holdings, never from a persona or Role name. It discloses only what the caller
//                   could already learn by trying: no other Principal's authority, and no inactive channel. The server
//                   stays authoritative -- a forged channel is still refused OUTSIDE_SALES_CHANNEL_SCOPE.
// Nothing else: no Role, Principal, tenant, subject, or capability outside the list.
//
// CAPABILITY. None beyond an active Principal with an active membership (the read kernel checks both inside its
// read-only snapshot). It describes only the caller, accepts no selector, and confers nothing -- every command re-checks.
// NO NEW CAPABILITY: the list names existing Commercial ids only.
import { admittedScopeValues } from "../adminPolicy/assignmentScopeRuntime";
import { RESERVED_CAPABILITY_HOLDERS } from "../adminPolicy/roleCapabilityAdministration";
import { qualifyingGlobalRoles } from "../eosOps/administrationReach";
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
  "salesAgreement.tradeIn.approve", // Owner ruling #204: lets the client offer Approve / Decline only to an approver.
  "salesOrder.read",
  "salesOrder.write",
] as const);


/** The Commercial writes in which the caller CHOOSES the channel (create / move): the picker's governed keys. */
export const CHANNEL_CHOOSING_CAPABILITY_IDS = Object.freeze(["opportunity.write", "salesOrder.write"] as const);

export interface MyCommercialCapabilities {
  readonly capabilities: readonly string[];
  readonly channelScoped: readonly string[];
  readonly channelOffers: Readonly<Record<(typeof CHANNEL_CHOOSING_CAPABILITY_IDS)[number], readonly string[]>>;
}

export function readMyCommercialCapabilities(deps: CommercialReadDeps, actor: CommercialReadActor, input?: Record<string, unknown>): Promise<MyCommercialCapabilities> {
  return runCommercialRead(deps, actor, [],
    () => {
      const extra = input && typeof input === "object" ? Object.keys(input) : [];
      if (extra.length > 0) fail("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read accepts no input: ${extra.sort().join(", ")}`);
    },
    // Runs only after the kernel confirmed the active Principal + active membership in the snapshot.
    async (client, tenantId) => {
      const { rows } = await client.query<{ sales_channel: string }>(
        `SELECT sales_channel::text AS sales_channel FROM eos_policy.tenant_sales_channels
          WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY sales_channel::text`,
        [tenantId],
      );
      const active = rows.map((r) => r.sales_channel);
      const offers = (id: string): readonly string[] => {
        if (actor.capabilities.has(id)) return Object.freeze([...active]);
        const scoped = new Set(admittedScopeValues(actor.scopedHeld, id, "salesChannel"));
        return Object.freeze(active.filter((c) => scoped.has(c)));
      };
      // A RESERVED capability (Owner G7) is offered only to a holder of a reserved Role -- the command refuses everyone else.
      const reservedOk = new Set<string>();
      for (const id of COMMERCIAL_OFFER_CAPABILITY_IDS) {
        const reserved = RESERVED_CAPABILITY_HOLDERS.get(id);
        if (!reserved || !actor.capabilities.has(id)) continue;
        if ((await qualifyingGlobalRoles(client, tenantId, actor.principalId, reserved.roleKeys)).length > 0) reservedOk.add(id);
      }
      const held = (id: string): boolean => actor.capabilities.has(id) && (!RESERVED_CAPABILITY_HOLDERS.has(id) || reservedOk.has(id));
      return {
        capabilities: COMMERCIAL_OFFER_CAPABILITY_IDS.filter(held),
        channelScoped: COMMERCIAL_OFFER_CAPABILITY_IDS.filter((id) => !actor.capabilities.has(id) && !RESERVED_CAPABILITY_HOLDERS.has(id) && admittedScopeValues(actor.scopedHeld, id, "salesChannel").length > 0),
        channelOffers: Object.freeze(Object.fromEntries(CHANNEL_CHOOSING_CAPABILITY_IDS.map((id) => [id, offers(id)]))) as MyCommercialCapabilities["channelOffers"],
      };
    });
}
