"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_VALIDATED_LINE_REFERENCES = exports.EQUIPMENT_MODELS_COLLECTION = exports.PARTS_COLLECTION = void 0;
exports.authorityCollectionFor = authorityCollectionFor;
exports.validateSalesAgreementLineReferences = validateSalesAgreementLineReferences;
exports.describeWrongKind = describeWrongKind;
const salesAgreementCommands_1 = require("./salesAgreementCommands");
exports.PARTS_COLLECTION = "parts";
exports.EQUIPMENT_MODELS_COLLECTION = "equipment_models";
/**
 * A guard against an unbounded fan-out, not an expected size. An agreement with more than this many
 * lines is refused by the line-count rule long before it reaches here; the cap exists so a future
 * change to that rule cannot silently turn one commit into an unbounded read.
 */
exports.MAX_VALIDATED_LINE_REFERENCES = 100;
/**
 * Which collection is authoritative for a kind, or null where no authority exists.
 *
 * Returning null is a POSITIVE statement -- "this kind has no catalogue to check against" -- and is
 * handled explicitly by the caller. It is not a fall-through.
 */
function authorityCollectionFor(kind) {
    if (kind === "PART")
        return exports.PARTS_COLLECTION;
    if (kind === "EQUIPMENT_MODEL")
        return exports.EQUIPMENT_MODELS_COLLECTION;
    // SERVICE: no service-code authority exists in this repository. Reported as a governance gap.
    return null;
}
/** How a line is named in an error a human reads. Never the Firestore id of anything. */
function lineLabel(line, index) {
    return line.lineId ?? `line ${index + 1}`;
}
/**
 * The single authoritative reference check, used by create, draft edit AND accept.
 *
 * Deliberately ONE function rather than a rule restated per callable: three copies of "does this
 * product exist" is three chances for one of them to drift into permissiveness, and the one that
 * drifts would be discovered by an invalid accepted agreement rather than by a test.
 *
 * Throws on the FIRST invalid line, naming it, so the surface can point at the row.
 */
async function validateSalesAgreementLineReferences(db, tx, lines) {
    if (!Array.isArray(lines) || lines.length === 0)
        return;
    if (lines.length > exports.MAX_VALIDATED_LINE_REFERENCES) {
        throw new salesAgreementCommands_1.SalesAgreementCommandError("LINE_INVALID", `An agreement may not carry more than ${exports.MAX_VALIDATED_LINE_REFERENCES} lines.`);
    }
    // Only the kinds that HAVE an authority are looked up. Pairing each with its original index keeps
    // the error able to name the offending line after the unvalidatable ones are filtered out.
    const checkable = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => authorityCollectionFor(line.kind) !== null);
    if (checkable.length === 0)
        return;
    // DISTINCT (collection, ref): the same part on three lines costs one read, not three.
    const keyOf = (l) => `${authorityCollectionFor(l.kind)}/${l.ref}`;
    const distinct = [...new Set(checkable.map(({ line }) => keyOf(line)))];
    const refs = distinct.map((key) => {
        const slash = key.indexOf("/");
        return db.collection(key.slice(0, slash)).doc(key.slice(slash + 1));
    });
    // getAll inside the transaction, so these reads are part of the committing snapshot.
    const snaps = await tx.getAll(...refs);
    const exists = new Map();
    snaps.forEach((snap, i) => exists.set(distinct[i], snap.exists));
    for (const { line, index } of checkable) {
        if (exists.get(keyOf(line)) === true)
            continue;
        const label = lineLabel(line, index);
        // WHICH MISTAKE WAS IT. Before reporting "no such Part", ask whether the reference is a real
        // entity of the OTHER kind -- picking the right product under the wrong type is a different
        // error with a different fix, and "no Part matches CW-C713" would send somebody to look for a
        // missing catalogue entry that is sitting right there under Equipment Models.
        const wrongKind = await describeWrongKind(db, tx, line);
        if (wrongKind)
            throw new salesAgreementCommands_1.SalesAgreementCommandError("REFERENCE_WRONG_KIND", `${label}: ${wrongKind}`);
        // The message says what is wrong and what to do, and never echoes a document id of another
        // entity. `ref` is the user's own input, so quoting it back identifies the mistake rather than
        // disclosing anything they did not type.
        throw new salesAgreementCommands_1.SalesAgreementCommandError("REFERENCE_NOT_FOUND", line.kind === "PART"
            ? `${label}: no Part matches "${line.ref}". Choose a Part from the catalog.`
            : `${label}: no Equipment Model matches "${line.ref}". Choose a model from the catalog.`);
    }
}
/**
 * WRONG-TYPE DETECTION, and why it is a separate pass.
 *
 * A Part id submitted as an EQUIPMENT_MODEL fails the existence check above already -- it is simply
 * not in `equipment_models`. But the resulting message ("no Equipment Model matches CW-P-0000")
 * invites the reader to conclude the catalogue is missing an entry, when the truth is that they
 * picked the right thing under the wrong type. Same reference, materially different fix.
 *
 * So when an existence check fails, this asks the OTHER authority whether the reference is a real
 * entity of a different kind, purely to tell the user which mistake they made. It never rescues an
 * invalid line -- both paths still reject.
 */
async function describeWrongKind(db, tx, line) {
    const own = authorityCollectionFor(line.kind);
    if (own === null)
        return null;
    const other = own === exports.PARTS_COLLECTION ? exports.EQUIPMENT_MODELS_COLLECTION : exports.PARTS_COLLECTION;
    const snap = await tx.get(db.collection(other).doc(line.ref));
    if (!snap.exists)
        return null;
    return other === exports.PARTS_COLLECTION
        ? `"${line.ref}" is a Part, but this line is an Equipment Model. Change the item type or choose a model.`
        : `"${line.ref}" is an Equipment Model, but this line is a Part. Change the item type or choose a part.`;
}
//# sourceMappingURL=salesAgreementLineReferences.js.map