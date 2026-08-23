// THE CERTIFICATION WORLD — versioned dataset identity and the marker every record carries.
//
// ============================ WHY A MANIFEST AND NOT JUST A SEEDER ============================
//
// A seeder answers "put this data in". A certification world has to answer three harder questions:
// WHICH data is in there, WHICH version of it, and WHAT IS MISSING. Without a manifest a partially
// applied seed is indistinguishable from a complete one -- the same failure this program has now met
// in four separate instruments, where an absent result read exactly like a clean one.
//
// So the dataset declares its expected shape up front, every record it writes carries a marker back
// to that declaration, and the seeder can therefore report "you have 812 of 947 expected records"
// instead of "done".
//
// ============================ THE MARKER, AND WHY RESET IS SAFE ============================
//
// Every document written by this world carries `certificationWorld: { version, datasetId }`. Reset
// deletes exactly and only documents carrying that marker. It never deletes by collection, never by
// prefix guess, and never touches a record it did not create -- so a sandbox that also holds
// baseline, transactional or persona fixtures keeps them.
//
// That is the whole reason ad-hoc cleanup was refused: a one-off delete of "the Cert Prospect rows"
// is unrepeatable, unreviewable, and cannot tell you afterwards what it removed.
// 1.1.0 (2026-08-21): the 47-employee WORKFORCE joins the world. It existed in data/workforce.mjs
// and drove every capacity and authority report, while buildWorld omitted it -- so  expected
// a world without the people the reports described, and the sandbox could never have contained them.
//
// THE VERSION BUMP IS THE POINT. Expected record count moves 670 -> 717, so a sandbox holding the
// 1.0.0 world now verifies as a VERSION MISMATCH rather than silently passing while missing 47
// records. Changing the expected world without changing its version is how a fixture system starts
// lying about what it contains.
// 1.2.0 (2026-08-21) -- DATA CORRECTION, not new content. Three defects made records either wrong
// or invisible, and all three change what the expected world contains:
//
//   * `status: "DORMANT"` on 5 customers was fixture drift. DORMANT is not a customer status; the
//     canonical set is ACTIVE/INACTIVE/PROSPECT/ARCHIVED. Corrected to INACTIVE.
//   * `nameLower` added. Firestore cannot compare case-insensitively, so customer search queries a
//     normalized copy of the name; without it, searching "mesquite" could not find "Mesquite".
//   * `relationshipTypes` populated representatively. Every account previously had none, so the
//     Relationship filter had nothing to filter and no VENDOR existed anywhere in the world.
//
// Seeded records also now carry createdAt/updatedAt, which the seeder stamps at write time rather
// than the builder -- volatile by declaration, and therefore not part of the fingerprint.
//
// THE BUMP IS THE POINT. A sandbox still holding 1.1.0 must report VERSION_MISMATCH rather than
// COMPLETE: it contains customers with an invalid status and no searchable name, and a fixture
// system that changes its expected world without changing its version is lying about what it holds.
// 1.3.0 (2026-08-22) -- THE INSTALLED BASE. 278 serialized Equipment assets join the world, so the
// expected record count moves 717 -> 995 and a sandbox holding 1.2.0 is a genuinely different world
// rather than a stale label.
//
// The distribution is deliberately uneven: customers owning nothing (the empty state is a real
// state), one unit, the ordinary 2-5, a few 6-10, and two high-density sites for visual stress --
// plus Taylor-only, Icetro-only and mixed fleets, because the Taylor/Ventana reporting separation is
// measured on lineOfBusiness and needs all three shapes to be measurable. Age and warranty are
// DERIVED from the install date rather than invented separately, so a unit cannot claim to be new
// and out of warranty at once.
// 1.4.0 (2026-08-22) -- THE SERVICE CATALOG. 37 certification parts join the world, sized and
// spread so all six inventory conditions can exist at once. The sandbox held SEVEN parts, and the
// conditions in data/inventory.mjs were designed against a catalog that was never built.
//
// The parts carry no balances. Balances are created by MOVEMENTS through the authoritative ledger,
// because on this schema the ledger IS the balance -- see data/inventoryPlan.mjs.
// 1.5.0 -- Pass 3. ONE bump for the whole pass, not one per sub-pass: the dataset is a single
// artifact and a version that moved four times would describe four things nobody installed.
//
// What changed:
//   opening balances are ADJUSTED/ADJUSTMENT, not fabricated receipts (142 movements -> 87)
//   truck stock is initialized where it sits, not transferred there from a phantom order
//   transfers, cycle counts and returns are exercised through their real commands
//   Golden set G01-G11; Tier-1 questions 30 -> 80; reporting truth substrate v1
//
// 1.6.0 -- EQUIPMENT MODELS BECOME REGISTRY RECORDS, AND MACHINES BECOME PARTS.
//
// `equipment_models` is the Equipment Compatibility registry, not a fixture collection of this
// world's own. Every model here was written under a `cw-model-taylor-c713` id in a shape the
// registry's validator refuses outright, and 278 equipment records pointed at those ids. Nothing
// complained because no consumer had ever read a model THROUGH the registry -- the same silence that
// hid the missing Part metadata until receiving became the first real consumer.
//
// It stopped being ignorable here: Part Master refuses a non-canonical `equipmentModelId`, so the
// whole-unit Parts could not have been written at all.
//
// What changed:
//   48 equipment models now carry canonical ids (TAYLOR--C713) and the registry's own record shape
//   278 equipment records follow, through the one derivation rather than a second inline copy
//   8 WHOLE-UNIT Parts -- one per model the unassigned cohort draws from, not one per machine
//   expected records 1084 -> 1092
//
// THE 1.5.0 SANDBOX DOES NOT MATCH THIS. Every one of those 48 model documents and 278 equipment
// back-references is now at a different id or a different shape, so this is not an additive install
// -- it is a correction of records that already exist live. That is a deliberate stop, not an
// oversight: see docs for the live divergence note.
//
// The live sandbox will report VERSION_MISMATCH against this until it is deliberately installed,
// which is the intended state -- nothing here has been deployed.
export const CERTIFICATION_WORLD_VERSION = "1.6.0";
export const MARKER_FIELD = "certificationWorld";

/**
 * Records created by earlier certification RUNS, before this world existed.
 *
 * `Cert Prospect <digits>` rows come from createReach.mjs, which deliberately uses a unique name per
 * run so a rerun can never pass on the previous run's record -- which also means they accumulate.
 * They carry no marker, so the marker-based reset cannot see them.
 *
 * Rather than delete them by hand, the rule that identifies them is written down HERE and executed by
 * the governed reset. A pattern in a reviewed file is repeatable and auditable; a one-off delete
 * command in a terminal is neither.
 *
 * Deliberately anchored and digit-bounded so it can only ever match this generator's output. It will
 * not match a real account a person named "Cert Prospect Holdings".
 */
export const LEGACY_CERTIFICATION_PATTERNS = Object.freeze([
  Object.freeze({
    collection: "accounts",
    field: "name",
    // eslint-disable-next-line no-useless-escape
    test: (v) => typeof v === "string" && /^Cert Prospect \d{6,}$/.test(v),
    describe: 'accounts named "Cert Prospect <digits>" (created by createReach.mjs journey runs)',
  }),
]);

/** Provenance of a fact in this dataset. Recorded per record, never inferred later. */
export const PROVENANCE = Object.freeze({
  // A real, publicly listed business fact: name, address, phone, website, category.
  PUBLIC: "PUBLIC_BUSINESS_LISTING",
  // Invented for certification. Everything operational is this: contacts, equipment ownership,
  // serials, dates, opportunities, orders, work orders, service history, inventory relationships.
  SYNTHETIC: "SYNTHETIC_CERTIFICATION_FACT",
});

// THE STATEMENT THAT MUST TRAVEL WITH THE DATA. A real business name attached to synthetic equipment
// ownership is a claim about that business, and it is false. Every Account built from a public
// listing carries this so the record itself says so -- not a README somebody may never read.
export const SYNTHETIC_OWNERSHIP_DISCLAIMER =
  "Business identity is a public listing. All equipment, contacts, orders, service history and " +
  "operational relationships on this record are SYNTHETIC certification data and do not describe " +
  "this business.";

export function marker(datasetId) {
  return { version: CERTIFICATION_WORLD_VERSION, datasetId };
}
