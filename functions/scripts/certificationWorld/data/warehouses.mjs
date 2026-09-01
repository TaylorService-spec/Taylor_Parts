// THE GOVERNED WAREHOUSE THE INVENTORY PLAN ALREADY DEPENDED ON — CERT-WH-MAIN-01.
//
// ============================ WHY THIS FILE EXISTS ============================
//
// Every warehouse-side opening balance in data/inventoryPlan.mjs books to `wh-main`. All 571 units
// of warehouse stock sit at that location. Until now no such warehouse record was ever built for a
// live world: `wh-main` was written by emulatorBootstrap.mjs and by nothing else, so the emulator
// had a governed warehouse and live certification had none.
//
// The consequence was silent and total. readPartBalance builds its eligible-warehouse set from
// `warehouses where status == "ACTIVE"` and drops every ledger row whose location is not in that
// set. With the collection empty the set is empty, so the governed on-hand read returned 0 for all
// 32 quantity-bearing parts while the ledger said 571. The world reported COMPLETE the entire time,
// because completeness was measured over the ten groups the builder emitted and this was not one of
// them.
//
// This is the FIFTH record type in this program to be internally consistent and unreadable by its
// own authority -- after Parts, the governed warehouse (in the emulator), the opening balances, and
// the trucks. The pattern each time is identical: a fixture writes a shape nobody validates, every
// consumer that merely SUMS the data works perfectly, and the first consumer that RESOLVES the
// record fails closed. So the record is defined once, here, against the real validator.
//
// ============================ THE CONTRACT IS validateGovernedWarehouse ============================
//
// Not this object literal, and not the emulator's former copy of it. src/warehouseGovernance/
// governedWarehouseValidation.ts is closed-key and pair-coherent, and it is what Receiving
// (receivingLocationResolver), Transfers (transferLocationResolver) and Reorder all run against the
// same bytes. Three consequences shape what is written below, and each one is a field that CANNOT
// be here rather than one that can:
//
//   * NO `dataProvenance`. Every other record in this world carries it. It is not an allowed key,
//     so a warehouse carrying the world's own provenance convention fails UNKNOWN_FIELD. The
//     synthetic nature of this record is recorded by the world it belongs to, not on its face.
//   * NO `active`. The trucks carry `active: true` because the mobile-location registry requires a
//     real boolean. The warehouse validator forbids the key outright -- status is the authority,
//     and a second, older liveness flag beside it is exactly the ambiguity ACTIVE_FORBIDDEN exists
//     to refuse.
//   * NO fixture marker. See the MARKERLESS note in certificationWorld.mjs. The closed-key contract
//     is the authority; the fixture system yields to it.
//
// NATIVE provenance additionally REQUIRES a coherent createdAt/createdBy pair and FORBIDS the
// governanceInitialized* pair. `createdBy`/`updatedBy` are supplied here; `createdAt`/`updatedAt`
// are supplied by the seeder (seedWrite.mjs stamps both as server timestamps), which is also why
// they are declared VOLATILE and excluded from the fingerprint. A builder that pinned them would
// make the record deterministic and the contract unsatisfiable at once: the validator requires a
// real Firestore Timestamp instance, which a pure builder has no way to produce.
//
// ============================ operatingCompanyId IS AN OWNER FACT ============================
//
// CERT-WH-COMPANY-02, resolved by Owner decision on 2026-08-31: wh-main belongs to TAYLOR.
//
// This field was held blocked rather than filled in, and the distinction matters. The validator
// treats it as optional -- "an absent field is a legacy root and is fine" -- and nothing in the
// baseline -> purchasing -> receiving lifecycle reads it, so the warehouse would have validated
// and Receiving would have worked without it. What would NOT have worked is Reorder:
//
//   projectReorderWarehouseOptions SILENTLY SKIPS a warehouse whose operatingCompanyId is absent or
//   does not resolve, so the picker would have offered an empty list with no error;
//   the reorder CREATE refuses outright with WAREHOUSE_NO_COMPANY, because the owning company is
//   DERIVED from the warehouse and a missing one cannot be invented.
//
// Every signal available to the fixture -- the Phoenix address, which accounts draw stock, the
// fleet's homeWarehouseId, relative company size -- is an inference, and an inference recorded as
// an ownership fact is a false fact that every downstream reorder would then inherit. So it was
// asked rather than derived. The identifier below is the canonical governed id from
// OPERATING_COMPANY_IDS.TAYLOR, not a display name and not a code.

/** The one eligible warehouse the certification world stocks. Mirrors CERT_WAREHOUSE_ID. */
export const CERT_WAREHOUSE_ID = "wh-main";

/** Written into createdBy/updatedBy. Matches the fleet records' author for the same reason. */
export const WAREHOUSE_RECORD_AUTHOR = "certification-world-builder";

/**
 * The operating company that owns wh-main. OWNER-DECIDED (CERT-WH-COMPANY-02), never derived.
 *
 * Mirrors OPERATING_COMPANY_IDS.TAYLOR. Written as a literal because this builder is a pure ESM
 * fixture and the authority is TypeScript; the governed-warehouse test asserts the two agree, so a
 * drift in either direction fails rather than silently storing an unresolvable company.
 */
export const CERT_WAREHOUSE_OPERATING_COMPANY_ID = "taylor";

/**
 * The deterministic governed warehouse record, as the DATA half of a world record.
 *
 * PURE: no clock, no Firestore, no timestamps. Returns a fresh object each call so no caller can
 * mutate a shared literal into a different world.
 */
export function certificationWarehouseData() {
  return {
    id: CERT_WAREHOUSE_ID,          // must EQUAL the document id, or ID_MISMATCH
    name: "Main Distribution Center",
    location: "Phoenix, AZ",
    status: "ACTIVE",               // the receiving/transfer eligibility authority
    version: 1,                     // a governed version is a whole number >= 1
    provenance: "NATIVE",           // requires the created pair; forbids governanceInitialized*
    createdBy: WAREHOUSE_RECORD_AUTHOR,
    updatedBy: WAREHOUSE_RECORD_AUTHOR,
    // OWNER DECISION, not an inference. See the note above. Permitted by the validator and
    // VALIDATED when present, so a typo or a display name would fail closed rather than be stored
    // as an ownership fact nobody can resolve.
    operatingCompanyId: CERT_WAREHOUSE_OPERATING_COMPANY_ID,
  };
}

/**
 * The full world record: collection, document id, data.
 *
 * ONE definition, used by buildWorld() and by emulatorBootstrap.mjs. The emulator previously
 * carried its own handwritten copy; two independent definitions of the same canonical shape is how
 * the emulator came to have a governed warehouse that live certification did not.
 */
export function certificationWarehouseRecords() {
  return [{
    collection: "warehouses",
    id: CERT_WAREHOUSE_ID,
    data: certificationWarehouseData(),
  }];
}
