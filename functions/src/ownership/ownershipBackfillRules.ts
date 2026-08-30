// EOS Ownership Model v1 — the BACKFILL RULES, shared by the simulation and the applier.
//
// ============================ WHY THIS MODULE EXISTS ============================
//
// The Owner authorized exactly 1,015 writes on the strength of a simulation. If the applier
// computed its candidates with its own copy of the rules, the number that was approved and the
// number that gets written would be produced by two pieces of code that merely agree today.
//
// So there is ONE rule set. The simulation tallies what these functions return; the applier writes
// what these functions return. A drift between "what was approved" and "what is written" is not
// possible, because there is nothing to drift from.
//
// This also satisfies the ruling's requirement 8 directly: the applier never consumes the
// simulation's JSON as write instructions. It recomputes from live data, through this module.
//
// ============================ WHAT A RULE MAY DO ============================
//
// Each rule sees ONE document and the governed context, and returns one of three things:
//
//   WRITE      the exact field patch to apply. Nothing else is ever written.
//   ALREADY_SET the ownership field is already present -- never overwritten (requirement 10).
//   PROTECTED   deliberately excluded, with the reason. One of the seven approved reasons.
//
// There is no fourth outcome, and in particular there is no "best guess". A rule that cannot
// resolve a governed source returns PROTECTED.
//
// PURE: no Firestore, no I/O, no clock. The caller reads documents and applies patches.

export type BackfillOutcome =
  | { kind: "WRITE"; patch: Record<string, unknown>; note?: string }
  | { kind: "ALREADY_SET" }
  | { kind: "PROTECTED"; reason: string };

export interface BackfillContext {
  /** accountId -> the owner's canonical Employee id. Only accounts with a resolvable owner appear. */
  readonly accountOwnerByAccountId: ReadonlyMap<string, string>;
  /** physical root id -> authored operating company, from the governed root configuration. */
  readonly rootCompanyById: ReadonlyMap<string, string>;
  /** equipment document id -> authored fixture fleet company, or null for anything unauthored. */
  readonly equipmentFleetCompany: (equipmentId: string) => string | null;
  /** job document id -> authored fixture Job company, or null. */
  readonly serviceJobCompany: (jobId: string) => string | null;
}

export interface BackfillDocument {
  readonly id: string;
  readonly data: Record<string, unknown>;
}

export interface BackfillRule {
  readonly collection: string;
  /** The ownership fields this rule writes. Used to prove an applier touches nothing else. */
  readonly fields: readonly string[];
  readonly evaluate: (doc: BackfillDocument, ctx: BackfillContext) => BackfillOutcome;
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

const at = (doc: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((cur, seg) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[seg] : undefined), doc);

const MARKER_FIELD = "certificationWorld";
const CERT_PROVENANCE = "SYNTHETIC_CERTIFICATION_FACT";
const isFixture = (d: Record<string, unknown>): boolean =>
  d[MARKER_FIELD] !== undefined || d.dataProvenance === CERT_PROVENANCE;

// ---------------------------------------------------------------- PERSON

/** contacts / locations -> the parent Account's owner. The only PERSON derivation authorized. */
function personFromAccount(doc: BackfillDocument, ctx: BackfillContext): BackfillOutcome {
  if (doc.data.owner !== undefined) return { kind: "ALREADY_SET" };
  const accountId = doc.data.accountId;
  if (!nonEmpty(accountId)) return { kind: "PROTECTED", reason: "no accountId" };
  const employeeId = ctx.accountOwnerByAccountId.get(accountId);
  // The three control accounts R-7 keeps ownerless propagate as unresolved, never a substitute.
  if (employeeId === undefined) return { kind: "PROTECTED", reason: "parent Account has no owner" };
  return { kind: "WRITE", patch: { owner: { type: "USER", id: employeeId } } };
}

// ---------------------------------------------------------------- COMPANY, from a physical root

function companyFromRoot(paths: readonly string[]) {
  return (doc: BackfillDocument, ctx: BackfillContext): BackfillOutcome => {
    if (doc.data.operatingCompanyId !== undefined) return { kind: "ALREADY_SET" };
    const ref = paths.map((p) => at(doc.data, p)).find(nonEmpty);
    if (!nonEmpty(ref)) return { kind: "PROTECTED", reason: "no location reference" };
    const company = ctx.rootCompanyById.get(ref);
    if (company === undefined) return { kind: "PROTECTED", reason: `root not authored: ${ref}` };
    return { kind: "WRITE", patch: { operatingCompanyId: company } };
  };
}

// ---------------------------------------------------------------- the rules

export const BACKFILL_RULES: readonly BackfillRule[] = Object.freeze([
  { collection: "contacts", fields: ["owner"], evaluate: personFromAccount },
  { collection: "locations", fields: ["owner"], evaluate: personFromAccount },

  { collection: "stock_locations", fields: ["operatingCompanyId"], evaluate: companyFromRoot(["warehouseId"]) },
  { collection: "trucks", fields: ["operatingCompanyId"], evaluate: companyFromRoot(["homeWarehouseId"]) },
  { collection: "cycle_counts", fields: ["operatingCompanyId"], evaluate: companyFromRoot(["location.locationId"]) },
  { collection: "receiving_orders", fields: ["operatingCompanyId"], evaluate: companyFromRoot(["receivingLocation.locationId"]) },

  {
    // Equipment takes its company from the AUTHORED fixture fleet, never from the model, the
    // manufacturer, lineOfBusiness, the customer, the title holder or a serial prefix.
    collection: "equipment",
    fields: ["operatingCompanyId"],
    evaluate: (doc, ctx) => {
      if (doc.data.operatingCompanyId !== undefined) return { kind: "ALREADY_SET" };
      if (!isFixture(doc.data)) return { kind: "PROTECTED", reason: "non-fixture record -- left untouched by rule" };
      const company = ctx.equipmentFleetCompany(doc.id);
      if (company === null) return { kind: "PROTECTED", reason: "fleet has no authored company" };
      return { kind: "WRITE", patch: { operatingCompanyId: company } };
    },
  },

  {
    collection: "fieldops_jobs",
    fields: ["operatingCompanyId"],
    evaluate: (doc, ctx) => {
      if (doc.data.operatingCompanyId !== undefined) return { kind: "ALREADY_SET" };
      const company = ctx.serviceJobCompany(doc.id);
      // The 4 non-fixture Jobs are absent from the authored map and stay unresolved.
      if (company === null) return { kind: "PROTECTED", reason: "not an authored certification Job -- left untouched by rule" };
      return { kind: "WRITE", patch: { operatingCompanyId: company } };
    },
  },

  {
    // The ledger has two shapes and BOTH are honoured exactly as the approved simulation classified
    // them -- a single-location entry gets a scalar company, a two-location entry gets a
    // PARTICIPATING PAIR. The ruling is explicit: do not reinterpret these during application.
    collection: "inventory_transactions",
    fields: ["operatingCompanyId", "sourceOperatingCompanyId", "destinationOperatingCompanyId"],
    evaluate: (doc, ctx) => {
      if (
        doc.data.operatingCompanyId !== undefined ||
        doc.data.sourceOperatingCompanyId !== undefined ||
        doc.data.destinationOperatingCompanyId !== undefined
      ) {
        return { kind: "ALREADY_SET" };
      }
      const here = at(doc.data, "location.locationId");
      const other = at(doc.data, "counterpartyLocation.locationId");
      const hereCompany = nonEmpty(here) ? ctx.rootCompanyById.get(here) : undefined;
      const otherCompany = nonEmpty(other) ? ctx.rootCompanyById.get(other) : undefined;

      if (hereCompany === undefined && otherCompany === undefined) {
        return { kind: "PROTECTED", reason: "no resolvable location reference" };
      }
      // Two locations that resolve to DIFFERENT companies is a movement across the boundary. It
      // takes a pair, not one owner -- picking an end would record a false fact.
      if (hereCompany !== undefined && otherCompany !== undefined && hereCompany !== otherCompany) {
        return {
          kind: "WRITE",
          patch: { sourceOperatingCompanyId: hereCompany, destinationOperatingCompanyId: otherCompany },
          note: "cross-company participating pair",
        };
      }
      return { kind: "WRITE", patch: { operatingCompanyId: (hereCompany ?? otherCompany)! } };
    },
  },

  {
    // PARTICIPATING_COMPANIES. Both required, and NO scalar owner is ever created here.
    collection: "transfer_orders",
    fields: ["sourceOperatingCompanyId", "destinationOperatingCompanyId"],
    evaluate: (doc, ctx) => {
      if (doc.data.sourceOperatingCompanyId !== undefined && doc.data.destinationOperatingCompanyId !== undefined) {
        return { kind: "ALREADY_SET" };
      }
      const from = at(doc.data, "origin.locationId") ?? doc.data.fromWarehouseId;
      const to = at(doc.data, "destination.locationId") ?? doc.data.toWarehouseId;
      if (!nonEmpty(from) || !nonEmpty(to)) return { kind: "PROTECTED", reason: "missing origin or destination" };
      const source = ctx.rootCompanyById.get(from);
      const destination = ctx.rootCompanyById.get(to);
      // BOTH participants or nothing. One of two is not a partial success.
      if (source === undefined || destination === undefined) {
        return { kind: "PROTECTED", reason: "origin or destination root not authored" };
      }
      return {
        kind: "WRITE",
        patch: { sourceOperatingCompanyId: source, destinationOperatingCompanyId: destination },
        note: source === destination ? "same-company" : "cross-company",
      };
    },
  },
]);

/**
 * The collections the Owner authorized, with their approved maximum write counts.
 *
 * The applier compares its recomputed candidates against these and STOPS on any excess. This is the
 * blast-radius control: a rule change that silently widened its own scope would be caught by the
 * number, not by a reviewer noticing.
 */
export const AUTHORIZED_WRITE_CAPS: Readonly<Record<string, number>> = Object.freeze({
  contacts: 337,
  locations: 180,
  equipment: 278,
  inventory_transactions: 99,
  transfer_orders: 47,
  fieldops_jobs: 41,
  cycle_counts: 24,
  stock_locations: 5,
  trucks: 2,
  receiving_orders: 2,
});

export const AUTHORIZED_TOTAL = Object.values(AUTHORIZED_WRITE_CAPS).reduce((a, b) => a + b, 0);
