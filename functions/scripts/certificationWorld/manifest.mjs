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
export const CERTIFICATION_WORLD_VERSION = "1.1.0";
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
