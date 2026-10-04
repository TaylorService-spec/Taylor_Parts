# UAT — Rental (DECISIONS #207, roadmap Package B)

Recorded 2026-10-03. The local proofs come from `functions/test/rentalPostgres.test.mjs`. They run over the real transports
(`/operations/rental`, `/operations/work-orders`, `/operations/finance`) against PostgreSQL. All data is SAMPLE/UAT. The
nonprod evidence is appended below once the package is deployed.

| Proof | Result |
|---|---|
| Authority | **PASS.** Six separate capabilities, held by their ruled analog roles and never by admin, Sales or Technicians. Sales cannot create an agreement, admin cannot designate fleet, and a Technician cannot read the workspace (403). |
| Fleet and agreement | **PASS.** Designation fixes the owner from custody (a Ventana unit is Ventana's), and replays are idempotent. The agreement is numbered `RA-YYYY-######` and starts as DRAFT with terms v1 ORIGINAL, then is activated. A site of another customer and CONSOLIDATED are refused. |
| AVAILABLE → RESERVED → DEPLOYED | **PASS.** The unit is reserved, then installed by the agreement's INSTALL Work Order. The Equipment is Taylor's, with the customer as custodian and site user. The movement is RENTAL_DEPLOYMENT −1, and the unit is ON_RENT. The owner cannot be rewritten (trigger). |
| Refusals | **PASS.** Each of these is refused: <ul><li>double booking (409)</li><li>an UNAVAILABLE unit (409)</li><li>Ventana's unit on a Taylor agreement (412)</li><li>a Work Order for the wrong site (412) or the wrong company (412)</li><li>rental and sale on one Work Order (400)</li><li>a fleet unit on a sale Work Order: hidden from its installable list and refused (412)</li><li>an unreserved unit on the rental Work Order (412)</li></ul> |
| Service while rented | **PASS.** A SERVICE_CALL Work Order on the rental Equipment completes. The Equipment stays ACTIVE and Taylor's. |
| Extension | **PASS.** An EXTENSION creates terms v2 and v1 is kept. An extension that changes the rate is refused, and the terms table is append-only. |
| Charges and Finance | **PASS.** <ul><li>A two-week period becomes a RENTAL package (READY, 151200 = 2 × 70000 + 11200 tax), with no Sales Order, Sales Agreement or financing.</li><li>The package creates a RECEIVABLE for the customer and a READY handoff with contract v3 (`rental` block, `ownershipTransfers: false`).</li><li>A customer payment fully applied settles it.</li><li>Refused: a partial period, missing tax evidence, an overlapping period, a period beyond the term, and a second delivery charge.</li><li>A NOT_DETERMINED delivery charge is HELD; the later tax determination produces v2 READY.</li></ul> |
| Exchange | **PASS.** A replacement reservation names the replaced assignment and deploys through its own INSTALL Work Order. The replaced unit's return is initiated, and both assignments keep their history. |
| Return and inspection | **PASS.** Return into Ventana's warehouse is refused. Receipt into Taylor Main gives: custody WAREHOUSE, ledger RENTAL_RETURN +1 (stock agrees with custody), Equipment INACTIVE with a RENTAL_RETURNED event, and the unit in INSPECTION (not reservable). Inspection NEEDS_SERVICE puts it on SERVICE_HOLD; a release with a reason makes it AVAILABLE. |
| Workspace | **PASS.** Available, on-rent (customer custody), due-back and DEPLOYED_WITHOUT_CURRENT_CHARGE are all answered from governed records. |
| Close, no sale, facts | **PASS.** Close is refused while a unit is out and allowed once all units are back; cancelling a deployed agreement is refused. Zero sales orders, agreements, financing arrangements or fulfillments. The owner is constant across every event, and the event log (DESIGNATED … SERVICE_HOLD_RELEASED) is append-only. |

## Nonprod evidence (2026-10-03)

Main `9922c68d` (PR #2022, CI 125/125) went out as Render deploy `dep-db0q490jo6nc739u2ji0`, with 94 migrations.
- **Seed and census.** The seed added `rentalAgreement` and `rentalEquipment`. The census shows 128 capabilities and tenant
  grants 512 → 542, with holders exactly as the frozen mapping and admin holding none.
- **UAT.** 96 steps passed, 0 failed.
- **Sample units.** RNT-UAT-0001 and -0002 were acquired through the governed acquire (EXISTING_COMPANY_ASSET).
- **Lifecycle.** RA-2026-000001 ran end to end (WO-2026-000100/101/102):
  - deploy, then service while rented, extension (terms v2) and exchange;
  - return into Taylor Main, inspection to SERVICE_HOLD and then AVAILABLE, and close;
  - 151,200 charged, settled and applied, and a HELD delivery charge superseded once its tax was determined.
- **What did not happen.** No sale, no financing and no ownership transfer.
- **Finding.** The handoffs are PENDING_DESTINATION: nonprod Taylor has no active accounting destination.
