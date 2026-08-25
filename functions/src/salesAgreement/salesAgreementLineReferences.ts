// PRODUCT REFERENCES ON A SALES AGREEMENT MUST NAME SOMETHING THAT EXISTS.
//
// ════════════════════ THE HOLE THIS CLOSES ════════════════════
//
// Until this module, the entire product-reference validation on a commercial line was:
//
//     if (!nonEmpty(l.ref)) throw ... `Line ${index} is missing a product reference`
//
// Non-empty. That is all it proved. So `{ kind: "PART", ref: "asdfgh", unitPrice: 50000000 }` was a
// valid Sales Agreement line: it could be drafted, ACCEPTED -- which binds the business to the price
// -- and then copied unchanged into a Sales Order by deriveSalesOrderLinesFromAgreement, which maps
// `{ kind, ref }` straight through. From there it reaches fulfillment as a thing somebody is
// expected to pick, ship and install.
//
// Every layer downstream was correct to trust the reference. The commitment boundary is where a
// reference has to become true, because acceptance is the point after which "we did not mean that"
// stops being available.
//
// ════════════════════ WHERE THE AUTHORITY ACTUALLY LIVES ════════════════════
//
// This module resolves against the EXISTING identity authorities and invents nothing:
//
//   PART             `parts/{partId}`            -- doc id IS the partId (== sku). Governed status
//                                                   enum DRAFT/ACTIVE/INACTIVE/SUPERSEDED/
//                                                   DISCONTINUED (partMaster/types.ts).
//   EQUIPMENT_MODEL  `equipment_models/{id}`     -- doc id IS the canonical equipmentModelId
//                                                   (`manufacturer--model`), D1 identity contract.
//                                                   Status DRAFT/ACTIVE/INACTIVE/RETIRED.
//   SERVICE          -- NO AUTHORITY EXISTS. See the gap note below.
//
// ════════════════════ WHY EXISTENCE AND TYPE, BUT NOT SELLABILITY ════════════════════
//
// Both catalogs carry a governed `status`, and it is tempting to also refuse a DISCONTINUED part
// here. That rule does not exist in this repository. `PART_STATUS_TRANSITIONS` governs how a status
// MAY CHANGE; nothing anywhere states which statuses may be SOLD, and no `sellable` field exists on
// either entity. Writing "only ACTIVE may be sold" here would not be enforcing governance -- it
// would be authoring commercial policy in a validation helper, and it would retroactively invalidate
// existing agreements the moment a part is discontinued for ordinary catalogue reasons.
//
// So this enforces the two facts that are unambiguously true or false -- the thing exists, and it is
// the KIND of thing the line claims -- and the sellability question is reported as a governance gap
// for an explicit decision rather than answered by implication.
//
// ════════════════════ SERVICE IS A REAL GAP, NOT AN OVERSIGHT ════════════════════
//
// `SERVICE` is one of the three declared SALES_AGREEMENT_LINE_KINDS and there is no service-code
// catalog, collection, or validator anywhere in the repository. It cannot be validated against an
// authority that does not exist.
//
// It is therefore left exactly as it is today -- non-empty ref, nothing more -- rather than being
// rejected. Rejecting it would silently delete a supported commercial capability under the banner of
// a correctness fix, and a service line is not made truer by refusing it. The gap is reported.
//
// ════════════════════ TOCTOU ════════════════════
//
// The reads take a Transaction, so they join the SAME snapshot as the write that follows. A part
// deleted between validation and commit aborts and retries the transaction rather than committing an
// agreement validated against a catalogue that no longer says that.
//
// This is also why acceptance revalidates instead of trusting the draft: a reference that was real
// when the draft was written is not evidence that it is real at the moment the business becomes
// bound to it.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { SalesAgreementCommandError } from "./salesAgreementCommands";
import type { SalesAgreementLineKind } from "./salesAgreementLifecycle";

export const PARTS_COLLECTION = "parts";
export const EQUIPMENT_MODELS_COLLECTION = "equipment_models";

/**
 * A guard against an unbounded fan-out, not an expected size. An agreement with more than this many
 * lines is refused by the line-count rule long before it reaches here; the cap exists so a future
 * change to that rule cannot silently turn one commit into an unbounded read.
 */
export const MAX_VALIDATED_LINE_REFERENCES = 100;

/** The line shape this validation needs. Deliberately narrower than BuiltAgreementLine. */
export interface ReferenceCheckableLine {
  lineId?: string;
  kind: SalesAgreementLineKind;
  ref: string;
}

/**
 * Which collection is authoritative for a kind, or null where no authority exists.
 *
 * Returning null is a POSITIVE statement -- "this kind has no catalogue to check against" -- and is
 * handled explicitly by the caller. It is not a fall-through.
 */
export function authorityCollectionFor(kind: SalesAgreementLineKind): string | null {
  if (kind === "PART") return PARTS_COLLECTION;
  if (kind === "EQUIPMENT_MODEL") return EQUIPMENT_MODELS_COLLECTION;
  // SERVICE: no service-code authority exists in this repository. Reported as a governance gap.
  return null;
}

/** How a line is named in an error a human reads. Never the Firestore id of anything. */
function lineLabel(line: ReferenceCheckableLine, index: number): string {
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
export async function validateSalesAgreementLineReferences(
  db: Firestore,
  tx: Transaction,
  lines: readonly ReferenceCheckableLine[],
): Promise<void> {
  if (!Array.isArray(lines) || lines.length === 0) return;
  if (lines.length > MAX_VALIDATED_LINE_REFERENCES) {
    throw new SalesAgreementCommandError(
      "LINE_INVALID",
      `An agreement may not carry more than ${MAX_VALIDATED_LINE_REFERENCES} lines.`,
    );
  }

  // Only the kinds that HAVE an authority are looked up. Pairing each with its original index keeps
  // the error able to name the offending line after the unvalidatable ones are filtered out.
  const checkable = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => authorityCollectionFor(line.kind) !== null);
  if (checkable.length === 0) return;

  // DISTINCT (collection, ref): the same part on three lines costs one read, not three.
  const keyOf = (l: ReferenceCheckableLine) => `${authorityCollectionFor(l.kind)}/${l.ref}`;
  const distinct = [...new Set(checkable.map(({ line }) => keyOf(line)))];
  const refs = distinct.map((key) => {
    const slash = key.indexOf("/");
    return db.collection(key.slice(0, slash)).doc(key.slice(slash + 1));
  });

  // getAll inside the transaction, so these reads are part of the committing snapshot.
  const snaps = await tx.getAll(...refs);
  const exists = new Map<string, boolean>();
  snaps.forEach((snap, i) => exists.set(distinct[i], snap.exists));

  for (const { line, index } of checkable) {
    if (exists.get(keyOf(line)) === true) continue;
    const label = lineLabel(line, index);

    // WHICH MISTAKE WAS IT. Before reporting "no such Part", ask whether the reference is a real
    // entity of the OTHER kind -- picking the right product under the wrong type is a different
    // error with a different fix, and "no Part matches CW-C713" would send somebody to look for a
    // missing catalogue entry that is sitting right there under Equipment Models.
    const wrongKind = await describeWrongKind(db, tx, line);
    if (wrongKind) throw new SalesAgreementCommandError("REFERENCE_WRONG_KIND", `${label}: ${wrongKind}`);

    // The message says what is wrong and what to do, and never echoes a document id of another
    // entity. `ref` is the user's own input, so quoting it back identifies the mistake rather than
    // disclosing anything they did not type.
    throw new SalesAgreementCommandError(
      "REFERENCE_NOT_FOUND",
      line.kind === "PART"
        ? `${label}: no Part matches "${line.ref}". Choose a Part from the catalog.`
        : `${label}: no Equipment Model matches "${line.ref}". Choose a model from the catalog.`,
    );
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
export async function describeWrongKind(
  db: Firestore,
  tx: Transaction,
  line: ReferenceCheckableLine,
): Promise<string | null> {
  const own = authorityCollectionFor(line.kind);
  if (own === null) return null;
  const other = own === PARTS_COLLECTION ? EQUIPMENT_MODELS_COLLECTION : PARTS_COLLECTION;
  const snap = await tx.get(db.collection(other).doc(line.ref));
  if (!snap.exists) return null;
  return other === PARTS_COLLECTION
    ? `"${line.ref}" is a Part, but this line is an Equipment Model. Change the item type or choose a model.`
    : `"${line.ref}" is an Equipment Model, but this line is a Part. Change the item type or choose a part.`;
}
