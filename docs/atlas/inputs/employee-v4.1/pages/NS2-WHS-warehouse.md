# NS2-WHS — Warehouse family

## NS2-WHS-01 Receiving
P1 source: North Star - Receiving P1 + design_handoff_receiving/. Workspace + multi-scan session + reorder journey + "Add existing unit" two-stage sheet + truth states + handheld.
**Roles.** Warehouse Manager / Parts Associate (receive against PO, multi-scan), Purchasing (arrival truth, partial-receipt exceptions), Parts Manager (reorder journey origin).
**Schema (desktop).** `[Queue: expected receipts / open ROs][Session: PO lines vs scanned, exceptions inline][Custody confirmation]` — handheld 390: scan-first, session progress, refusal queue.
**Interaction.** Receipt lines invoke governed inventoryReceiving commands; partial receipt and supplier substitution are first-class exception paths (brief §12), never buried. Add-existing-unit hands off to EQP-01.
**Open.** RCV-G1 (receipt-history read), RCV-G2 (RO numbering), RCV-D1 (one queue vs two journeys — Owner).

## NS2-WHS-02 Warehouse mobile
PROPOSED-ONLY. Scope in P2: pick/putaway/transfer execution on handheld, sharing the scan-session grammar established by Receiving and Cycle Counts (focused input, first scan = hardware test, refusal/offline queue). No design until its commands are audited.


OBSERVED AGAINST: REVERIFICATION REQUIRED AT FAMILY OPEN (see ns2/ATLAS-OBSERVATION-BASE.md — seeded from findings at/before ATLAS-BASE-2026-09-10-A).
