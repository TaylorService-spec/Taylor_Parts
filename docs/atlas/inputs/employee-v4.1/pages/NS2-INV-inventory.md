# NS2-INV — Inventory family

## NS2-INV-02 Parts workspace / NS2-INV-03 Part record
P1 source: North Star - Parts P1v2 (annotation pattern of record) + design_handoff_parts/.
**Do.** Workspace: service-impacting shortages first, reorder work, arrivals; Work/Flow subordinated to a rail; absence priced at one line. Record by job: Overview | Demand & Purchasing | Details & Identifiers | History (partDetailView, identifiers, tracking mode, ledger events).
**Roles.** Parts Associate (find/pick/locate), Parts Manager (replenish — deep link My Work → Reorder → Demand & Purchasing), Purchasing (PO origin), Technician (availability from WO), Dispatcher (blocked-WO cause).
**Record schema.** `[Part identity + on-hand by location + attention][Demand & Purchasing: usage, reorder rationale (AI explainable)][Identifiers/aliases][Ledger history]`.
**Interaction.** Reorder recommendation is explained, accepting it invokes the normal purchasing command (PUR-01). Duplicate/alias signal is an AI suggestion, never an auto-merge.

## NS2-INV-04 Cycle Counts
P1v2 source of record (Owner-approved 2026-09-10, live tokens). Operating model: one sheet per location, many Parts per sheet, line-level blind count.
**Roles.** Counter (Parts Associate / Technician with inventoryCycleCountCounter; technician scope = assigned trucks — assignment answers *which*, capability answers *whether*), Parts/Warehouse Manager (per-line review/disposition — no whole-sheet approve).
**Invariants (design contract).** Expected qty + variance hidden until the line is submitted (per-line reveal, no cross-line leakage); multi-scan continues without redirect; scanner readiness per CC-D9 (focused input, first scan is the hardware test, camera/manual fallback).
**Schema (counter, 390).** `[Sheet header: location, progress][Scan target + qty entry][Submitted lines: revealed variance][Refusals/offline queue]` — manager review: sheet list → line dispositions.
**Open.** CC-B1 recount semantics, CC-B2 Finish Counting state (Owner decisions, not design authority).

## NS2-INV-01 Inventory dashboard
Slice-and-dice panels with authority labels; P2 overlap question vs HOME-01 Parts (P2-D5).

## NS2-INV-05 Transfers & Trucks
PROPOSED-ONLY; custody model unverified (P2-G4). Design desired experience only after authority audit.


OBSERVED AGAINST: REVERIFICATION REQUIRED AT FAMILY OPEN (see ns2/ATLAS-OBSERVATION-BASE.md — seeded from findings at/before ATLAS-BASE-2026-09-10-A).
