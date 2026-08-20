import { Button } from "../ui/primitives/index.js";

// PART MASTER > BARCODE / IDENTIFIERS.
//
// A barcode is an IDENTIFIER, not a quantity and not an authority. Scanning one resolves
// WHICH Part you are holding; it grants nothing and moves nothing. That separation is the
// whole design, and it is already enforced upstream in domain/scannedIdentity.js:
// "Scanning resolves IDENTITY. Scanning does NOT determine AUTHORITY."
//
// ONE IDENTITY SYSTEM, NOT A SECOND ONE. Part barcodes belong to the governed part_aliases
// authority that already exists -- createPartAlias / deactivatePartAlias / resolvePartAlias
// and valueFingerprint for collision detection are all written and unit-tested in
// functions/src/partMaster/partAliasCommands.ts. This screen is their missing front end, not
// a new store. A serialized-equipment tag is NOT a Part barcode and belongs to serialized-
// asset identity; a location barcode belongs to the warehouse/location authority. They are
// deliberately not interchangeable, so this section talks about Part identifiers only.
//
// ================= WHY EVERY CONTROL HERE IS DISABLED =================
//
// The commands exist. What does NOT exist is any way for a browser to reach them:
//
//   1. No onCall adapter is exported for any alias command, so there is no deployed
//      endpoint to call.
//   2. firestore.rules closes part_aliases to all client access, so there is no direct
//      read path either.
//   3. The collection is unpopulated -- nothing seeds or migrates into it.
//
// Rendering a live "Add barcode" button would therefore produce a control that fails every
// time, and rendering an empty list would state something this screen cannot know: that this
// Part has no identifiers. It says UNAVAILABLE instead, and names the three missing pieces
// exactly, because "disabled" without a reason is indistinguishable from "broken".
const MISSING_AUTHORITY = [
  "No deployed callable: the alias commands (createPartAlias, deactivatePartAlias) have no onCall adapter exported from functions/src/index.ts.",
  "No client read path: firestore.rules denies all client access to part_aliases (Admin-SDK only, by design).",
  "No data: the part_aliases collection is unpopulated — nothing seeds or migrates into it.",
];

export default function PartIdentifiersSection({ partId, partNumber }) {
  return (
    <section aria-labelledby="part-identifiers-h">
      <h3 id="part-identifiers-h">Barcode &amp; Identifiers</h3>

      <p className="fo-muted">
        Alternate identifiers this part is also known by — UPC/EAN/GTIN barcodes, a
        manufacturer part number, a supplier SKU, a legacy internal number. Each resolves to
        exactly one canonical Part, so a scan can never be ambiguous about what it found.
      </p>

      {/* UNAVAILABLE, not EMPTY. An empty list would assert this Part has no identifiers,
          which is a claim about data this screen cannot read. */}
      <p className="fo-warning" role="status">
        Identifiers cannot be shown for{" "}
        <strong>{partNumber || partId || "this part"}</strong>: the governed identifier surface
        is not reachable from the browser yet. This is not an empty list — it is an unread one.
      </p>

      <ul className="fo-list">
        {MISSING_AUTHORITY.map((reason) => (
          <li key={reason} className="fo-muted">{reason}</li>
        ))}
      </ul>

      {/* Protected variant: disabled, and says why on the control itself rather than only in
          prose above it, so the reason travels with the thing the user tried to click. */}
      <div className="fo-chip-row">
        <Button
          variant="protected"
          reason="Adding an identifier needs a deployed alias command. The command exists and is tested; no onCall adapter is exported for it."
        >
          Add barcode
        </Button>
        <Button
          variant="protected"
          reason="Deactivating an identifier needs the same deployed alias command."
        >
          Deactivate
        </Button>
      </div>

      <p className="fo-muted">
        Collision handling is already decided in the governed command, not here: an identifier
        is stored with a normalized fingerprint, and one active value may resolve to only one
        canonical Part. A second Part claiming a live identifier is rejected by the command
        rather than accepted and disambiguated later.
      </p>
    </section>
  );
}
