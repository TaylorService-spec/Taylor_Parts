"use strict";
// EOS Ownership Model v1 — the census CLASSIFIER (Owner authorization, next-pass item 12).
//
// The counting logic lives here, under typecheck and under test, rather than inside the CLI
// script that reads Firestore. A census whose classification rules only exist in an unrunnable
// script is a number nobody can check, and this number decides whether enforcement may be turned
// on -- so it is exercised by functions/test/ownershipCensus.test.mjs against a fake document
// source, with no emulator and no credentials.
//
// READ-ONLY BY CONSTRUCTION: nothing in this module can write. It takes documents and returns
// counts.
//
// It classifies using the SAME derivations the runtime uses (typedOwner.ts) over the SAME family
// declarations the handoff command uses (ownershipMatrix.ts), so a census total cannot disagree
// with what the application would derive for the same document.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_FAMILIES = exports.CENSUS_FAMILIES = exports.MAX_SAMPLE_IDS = void 0;
exports.censusBucket = censusBucket;
exports.classifyDocument = classifyDocument;
exports.censusFamily = censusFamily;
exports.censusGate = censusGate;
const typedOwner_1 = require("./typedOwner");
const ownershipMatrix_1 = require("./ownershipMatrix");
const operatingCompanyAuthority_1 = require("./operatingCompanyAuthority");
exports.MAX_SAMPLE_IDS = 10;
const emptyCounts = () => ({ resolved: 0, ownerless: 0, invalid: 0, unknown: 0, ambiguous: 0 });
/** Which bucket a derivation lands in. The one place resolution+code becomes a column. */
function censusBucket(derivation) {
    if (derivation.resolution === typedOwner_1.OWNERSHIP_RESOLUTION.RESOLVED)
        return "resolved";
    if (derivation.resolution === typedOwner_1.OWNERSHIP_RESOLUTION.OWNERLESS)
        return "ownerless";
    if (derivation.resolution === typedOwner_1.OWNERSHIP_RESOLUTION.AMBIGUOUS)
        return "ambiguous";
    // UNRESOLVED without a code should be impossible -- every UNRESOLVED path sets one. Counting an
    // uncoded one as INVALID keeps it visible rather than dropping it from the totals.
    return derivation.code === "UNKNOWN" ? "unknown" : "invalid";
}
/**
 * Classify one document against its family's declared ownership storage.
 *
 * A family with NO declared ownerFields is OWNERLESS by construction. That is the honest answer
 * for the entire company-owned section until `operatingCompanyId` exists, and it is reported
 * rather than skipped -- a skipped family would read as a clean zero, which is the one wrong
 * answer a gate like this must never produce.
 */
function classifyDocument(family, data) {
    // PARTICIPATING_COMPANIES resolves only when BOTH participants are present. One of two is not
    // half-owned -- it is a transaction that does not yet say where it went, which is unresolved.
    if (family.ownerClass === "PARTICIPATING_COMPANIES") {
        const fields = family.participatingFields ?? [];
        const present = fields.filter((f) => typeof data?.[f] === "string" && data[f].trim().length > 0);
        if (present.length === 0) {
            return { resolution: typedOwner_1.OWNERSHIP_RESOLUTION.OWNERLESS, owner: null, reason: "no participating companies recorded", code: null };
        }
        if (present.length < fields.length) {
            return {
                resolution: typedOwner_1.OWNERSHIP_RESOLUTION.UNRESOLVED, owner: null,
                reason: `only ${present.length} of ${fields.length} participating companies recorded`, code: "INVALID",
            };
        }
        const unresolved = present.filter((f) => (0, operatingCompanyAuthority_1.resolveOperatingCompany)(data[f]).company === null);
        if (unresolved.length > 0) {
            return { resolution: typedOwner_1.OWNERSHIP_RESOLUTION.UNRESOLVED, owner: null, reason: `participating company not governed: ${unresolved.join(", ")}`, code: "UNKNOWN" };
        }
        // No single `owner` is produced, and that is the point -- the shape IS the pair.
        return { resolution: typedOwner_1.OWNERSHIP_RESOLUTION.RESOLVED, owner: null, reason: null, code: null };
    }
    // A COMPANY family may hold a PARTICIPATING PAIR on individual records: an inventory movement
    // between two companies takes source+destination rather than one owner, exactly as a transfer
    // does. The family is still single-company in the ordinary case, so the pair is a fallback rather
    // than the declaration -- and without it the census reports a correctly-recorded cross-company
    // movement as OWNERLESS, which is the reader being wrong about the data rather than the reverse.
    if (family.ownerClass === "COMPANY" && (family.participatingFields?.length ?? 0) > 0) {
        const scalarPresent = family.ownerFields.some((f) => data?.[f] !== undefined);
        if (!scalarPresent) {
            const pair = family.participatingFields;
            const present = pair.filter((f) => typeof data?.[f] === "string" && data[f].trim().length > 0);
            if (present.length === pair.length) {
                const ungoverned = present.filter((f) => (0, operatingCompanyAuthority_1.resolveOperatingCompany)(data[f]).company === null);
                if (ungoverned.length > 0) {
                    return {
                        resolution: typedOwner_1.OWNERSHIP_RESOLUTION.UNRESOLVED,
                        owner: null,
                        reason: `participating company not governed: ${ungoverned.join(", ")}`,
                        code: "UNKNOWN",
                    };
                }
                return { resolution: typedOwner_1.OWNERSHIP_RESOLUTION.RESOLVED, owner: null, reason: null, code: null };
            }
            if (present.length > 0) {
                return {
                    resolution: typedOwner_1.OWNERSHIP_RESOLUTION.UNRESOLVED,
                    owner: null,
                    reason: `only ${present.length} of ${pair.length} participating companies recorded`,
                    code: "INVALID",
                };
            }
        }
    }
    if (family.ownerFields.length === 0) {
        return {
            resolution: typedOwner_1.OWNERSHIP_RESOLUTION.OWNERLESS,
            owner: null,
            reason: "family has no ownership storage yet",
            code: null,
        };
    }
    const derivations = family.ownerFields.map((field) => {
        if (field === "accountOwner")
            return (0, typedOwner_1.deriveAccountOwner)(data);
        // The typed owner the backfill writes. Without this the census reports a backfilled record as
        // OWNERLESS -- a projection that cannot read its own storage describes a backlog that is gone.
        if (field === "owner")
            return (0, typedOwner_1.deriveStoredOwner)(data, field);
        if (family.ownerType === "COMPANY")
            return (0, typedOwner_1.deriveCompanyOwner)(data, field);
        return (0, typedOwner_1.deriveEmployeeRefOwner)(data, field);
    });
    return (0, typedOwner_1.combineOwnerDerivations)(derivations);
}
/** Tally one family's documents. `truncated` says a --limit cut the scan short -- never silently. */
function censusFamily(family, documents, truncated = false) {
    const counts = emptyCounts();
    const reasons = {};
    const samples = { invalid: [], unknown: [], ambiguous: [], ownerless: [] };
    for (const doc of documents) {
        const derivation = classifyDocument(family, doc.data);
        const key = censusBucket(derivation);
        counts[key] += 1;
        if (key === "resolved")
            continue;
        // The reason TALLY is the volume-safe answer: a family with 40,000 ownerless rows reports one
        // line saying so, instead of 40,000 ids or a truncated sample that hides the shape.
        const reason = derivation.reason ?? "(no reason given)";
        reasons[reason] = (reasons[reason] ?? 0) + 1;
        if (samples[key].length < exports.MAX_SAMPLE_IDS)
            samples[key].push(doc.id);
    }
    return {
        family: family.family,
        collection: family.collection,
        ownerClass: family.ownerClass,
        ownerType: family.ownerType ?? "",
        scanned: documents.length,
        truncated,
        counts,
        reasons,
        samples,
    };
}
/**
 * The gate the ruling defined: enforcement may be assessed only when NOTHING is outstanding.
 *
 * A family that could not be READ blocks the gate too. A permission or index failure that counted
 * as zero would let enforcement be enabled over records nobody managed to look at -- the exact
 * failure mode "do not deploy enforcement solely because the code exists" is guarding against.
 */
function censusGate(reports) {
    const unreadable = reports.filter((r) => "error" in r).map((r) => r.family);
    const ok = reports.filter((r) => !("error" in r));
    const totals = emptyCounts();
    for (const r of ok) {
        for (const k of Object.keys(totals))
            totals[k] += r.counts[k];
    }
    const blocking = totals.ownerless + totals.invalid + totals.unknown + totals.ambiguous;
    // A TRUNCATED family also blocks. A --limit run measured a page, not a population, and a gate
    // decided on a page would be a guess wearing a number's clothes.
    const truncated = ok.filter((r) => r.truncated).map((r) => r.family);
    return {
        blocking,
        unreadable,
        truncated,
        totals,
        assessable: blocking === 0 && unreadable.length === 0 && truncated.length === 0,
    };
}
/**
 * Every family the census must cover: the OWNABLE ones (ruling D-8). REFERENCE and EXCLUDED
 * families are deliberately absent -- they are not ownerless-in-error, they are not owned, and
 * counting them would report a backlog that no decision could ever clear.
 *
 * Exported so the CLI cannot iterate a narrower list of its own choosing.
 */
exports.CENSUS_FAMILIES = (0, ownershipMatrix_1.ownableFamilies)();
/** The full matrix, for reporting the classification itself rather than the ownership counts. */
exports.ALL_FAMILIES = ownershipMatrix_1.OWNERSHIP_MATRIX;
//# sourceMappingURL=ownershipCensus.js.map