# Parts / Inventory / Truck Protected-Domain Parity Fence — 2026-09-16

**Status:** ACTIVE PROGRAM GUARDRAIL  
**Applies to:** every Authorization v2, PostgreSQL, Render, zero-Firebase, mobile/PWA, data-migration, and Administration workstream that can touch Parts, Inventory, Warehouse/Bin, Truck/Mobile Location, Purchasing/Receiving, Transfers, Cycle Counts, or Work-Order inventory effects.

> The purpose of the platform convergence is to move EOS onto the target technical architecture **without re-deciding business behavior that has already been designed, implemented, proven, or Owner-accepted**. A storage, transport, identity, authorization, or hosting migration is not permission to redesign the Parts / Inventory / Truck operating model.

---

## 1. Owner concern this fence resolves

The Parts / Inventory / Truck family contains some of the most mature business behavior in EOS. It has accumulated substantial lifecycle rules, custody rules, stock mathematics, idempotency, separation-of-duties, scanner behavior, purchasing/receiving flow, truck/mobile-location behavior, and audit evidence.

The zero-Firebase and PostgreSQL convergence creates a real risk if broad phrases such as "cut over Inventory" or "move Truck to PostgreSQL" are interpreted as permission to simplify, generalize, rewrite, or re-model those processes.

**That interpretation is prohibited.**

The target is:

`SAME BUSINESS TRUTH + SAME VALID ACTIONS + SAME INVALID ACTIONS + SAME AUDIT CONSEQUENCES`

with a different technical substrate where required.

---

## 2. Default change classification

For these protected domains, every proposed change must be classified before implementation as exactly one of:

1. **PARITY MIGRATION** — storage, transport, identity linkage, authorization evaluation, deployment substrate, or client plumbing changes while business semantics remain unchanged.
2. **GAP COMPLETION** — implements an already-recorded missing capability without changing an existing completed rule.
3. **BUSINESS BEHAVIOR CHANGE** — changes stock meaning, lifecycle, valid/invalid actions, custody, quantities, scope, responsibility, timing, or accounting consequence.

Only **PARITY MIGRATION** is automatically within the platform-convergence roadmap.

A **GAP COMPLETION** must be tied to the existing governing requirement/decision.

A **BUSINESS BEHAVIOR CHANGE requires separate Owner authorization** and may not be hidden inside a Firebase exit, PostgreSQL cutover, Authorization v2, mobile, UI, or refactor PR.

---

## 3. Protected business semantics

The following are treated as existing business/domain contracts to preserve unless a later explicit Owner decision changes one.

### 3.1 Part identity and catalog

- One canonical Part identity; aliases resolve to the Part and do not create a second Part authority.
- Supplier-item commercial/procurement terms remain distinct from Part identity and from committed acquisition cost.
- Scanner lookup uses governed Part/alias resolution; it must not invent a second lookup vocabulary during migration.
- A descriptive catalog migration must not silently alter inventory quantities, custody, commitments, or historical movement evidence.

### 3.2 Inventory ledger and physical on-hand

- Inventory movement history remains append-only evidence; migration must not turn history into mutable balances.
- The canonical movement-sign/on-hand calculation remains one rule, not per-feature arithmetic.
- Exact-location sufficiency remains exact-location sufficiency; one Bin, Warehouse, or Truck/Mobile location may not silently borrow stock from another to make a command pass.
- Unknown quantity/custody remains unknown; migration may not convert missing evidence into zero or available.
- Opening balance remains distinct from later operational movements and Cycle Count corrections.

### 3.3 Warehouse and Bin custody

- A Warehouse remains the custody parent; an authoritative Bin is a child position within that Warehouse.
- Bin placement alone does not imply a quantity movement.
- Moving stock inside one Warehouse remains relocation; moving stock across custody boundaries remains Transfer.
- Same-custody-parent movement must not be reclassified as a Transfer merely because storage changes.
- Bin parentage comes from governed authority, never from string/id inference.

### 3.4 Truck / Mobile Location

- Truck and MOBILE inventory location are distinct records connected by a governed relationship.
- Stock rides on the MOBILE location authority; Truck business metadata does not become a competing inventory quantity authority.
- MOBILE-location operating company is an authored/governed fact and **must not be inferred from the truck home Warehouse**.
- Existing location identities referenced by ledger evidence are preserved through migration; migration does not "clean up" ids in a way that breaks history.
- The Truck↔MOBILE 1:1 invariant must survive PostgreSQL cutover.
- Employee/Technician/driver linkage may be completed, but completion must not rewrite inventory identity or historical custody semantics.

### 3.5 Reservation, consumption, release, and Work Order inventory effects

- Reservation/commitment, release, and consumption remain distinct inventory consequences.
- Work Order lifecycle effects must remain idempotent/replay-safe.
- Technician/field execution may not bypass location sufficiency, assignment scope, or governed stock movement merely because the client becomes mobile/PWA/native.
- A retry/replay may re-drive an already-authorized effect; it may not create a second business effect.

### 3.6 Reorder / Purchasing / Receiving

- Reorder Request lifecycle and its governed handoffs remain intact.
- Reorder and Purchase Order identity/cardinality rules remain intact unless separately changed.
- Operating company/warehouse facts continue to be derived/stated by the governed authority defined for the workflow, not accepted from arbitrary client input.
- Receiving remains a stock event backed by its source order and idempotency contract.
- Partial/multi-line receiving improvements may extend the process but may not reinterpret historical receipts.

### 3.7 Transfer

- Transfer changes custody/location across the governed boundary and preserves immutable movement evidence.
- Source sufficiency is evaluated at the real source location.
- Transfer does not become a generic "move anything anywhere" command during API consolidation.
- Mobile execution may change UX/transport, not transfer truth.

### 3.8 Cycle Count

- Cycle Count v2 sheet/line model, blind counting, variance, separation of duties, reconciliation, and close/cancel behavior remain the business contract.
- A count correction creates governed inventory consequence/evidence; it does not rewrite prior movement history.
- Retired v1/Certification artifacts remain historical/retired and are not revived as a shortcut during migration.

### 3.9 Scanning and offline/mobile behavior

- Scanner permissions are capability-derived and server enforcement remains authoritative.
- Offline queueing may defer a command but may not reinterpret, merge, reorder, or duplicate business intent.
- Mobile/PWA/native work must call the same governed EOS commands as desktop/web; it does not get a parallel "field shortcut" inventory model.

---

## 4. What the platform reset MAY change

Without a separate business-process decision, convergence work may change only the technical implementation of the protected behavior, including:

- Firestore storage -> PostgreSQL storage;
- Firebase Function/callable -> Render/EOS API command;
- Firebase Auth subject -> EOS Principal / OIDC identity binding;
- old capability resolver -> Authorization v2 evaluator;
- client Firestore read -> governed EOS API read;
- web-only presentation -> web/PWA/mobile client using the same API;
- legacy claim/guard records -> equivalent database constraint where the claim exists only because the old database could not enforce the invariant;
- migration/copy/verification mechanics required to preserve existing records and evidence.

These changes must be **semantics-preserving**.

---

## 5. What the platform reset MAY NOT change implicitly

The following are stop conditions requiring explicit review and, where they change behavior, separate Owner authorization:

- changing movement type meaning or sign;
- replacing append-only movement evidence with a mutable current-balance table as authority;
- changing what counts as available/on-hand/committed;
- changing warehouse/bin/mobile custody relationships;
- inferring operating company, employee, technician, truck, or warehouse relationships from convenient data where the current contract requires an authored/governed fact;
- collapsing Truck and MOBILE location into one identity if doing so changes ledger/custody semantics;
- changing reorder, PO, receiving, transfer, or Cycle Count lifecycle transitions;
- changing who may perform an action as a side effect of migrating Authorization v2;
- widening a Parts/Warehouse/Truck user's record scope;
- silently removing a separation-of-duties rule;
- changing scanner behavior or allowing an offline path to bypass a server refusal;
- renumbering/re-keying records referenced by immutable operational evidence;
- modifying historical quantities to make the new model balance;
- broad refactors that delete existing parity tests before equivalent target-stack tests exist.

---

## 6. Mandatory parity gate before any protected-domain cutover

No protected object/process may switch runtime authority from the current implementation to PostgreSQL/Render/Authorization v2 until all applicable gates pass.

### Gate P1 — Current contract census

Record the current authoritative commands, reads, lifecycle states, calculations, scopes, idempotency rules, audit effects, and known accepted UI behavior. Existing repository tests/decisions are evidence, not disposable implementation detail.

### Gate P2 — Target mapping

For every current authoritative read/write, name the exact PostgreSQL/Render/v2 replacement. "Handled by the new API" is not sufficient.

### Gate P3 — Same-input/same-result proof

Run deterministic parity cases proving materially equivalent inputs produce the same:

- allowed/refused outcome;
- stock quantity consequence;
- source/destination custody;
- lifecycle result;
- idempotent replay behavior;
- authorization/scope outcome;
- audit/business evidence.

### Gate P4 — Connected scenario proof

Use connected scenarios spanning at minimum:

- reorder -> purchase -> receive -> put away;
- warehouse/bin relocation;
- warehouse <-> truck/mobile Transfer;
- technician/Work Order reserve -> consume/release;
- truck/mobile Cycle Count -> reconcile;
- scanner lookup + governed movement;
- partial/error/retry paths applicable to each process.

### Gate P5 — Migration reconciliation

Before cutover, prove source and target counts/identities/quantities/relationships reconcile. Differences must be classified and resolved; no balancing by silent data mutation.

### Gate P6 — No mixed-authority ambiguity

At cutover there must be one named write authority per fact. Do not leave both Firebase and PostgreSQL writable for the same business fact unless a separately reviewed migration mechanism explicitly requires it and proves conflict behavior.

### Gate P7 — Running-application acceptance

Verify the real client against the target stack for Parts Manager, Parts Associate/Warehouse, Technician/Truck, and Manager/Reconciler personas. CI alone is not acceptance.

### Gate P8 — Legacy retirement only after proof

Only after target acceptance may the old transport/storage path be made unreachable. Historical evidence is retained according to its governing rules; retirement does not mean deleting operational history.

---

## 7. Explicit clarification of roadmap percentages

The master roadmap currently records approximately:

- Truck / Mobile Location object: strong/mature, with target-stack linkage work remaining;
- Cycle Count: strong/mature, with target-stack runtime convergence remaining;
- Reorder -> purchase -> receive: one of the strongest EOS workflow families;
- Inventory ledger / relocation / transfer: mature domain semantics with PostgreSQL/runtime convergence still required.

The lower percentage shown for **"Technician truck part scan/consume -> Work Order -> invoice"** is **not a statement that Truck Inventory is only partly built**. That row measures a larger commercial chain through invoicing, including pricing/tax/invoice attachment and return/refund handling. The already-built Truck/Inventory custody and movement behavior is protected by this fence.

Likewise, "remaining PostgreSQL cutover" means **move the authority while preserving the process**, not redesign the process.

---

## 8. Sequencing rule

Parts / Inventory / Truck convergence is therefore executed in this order:

1. freeze and inventory the accepted/current business contracts;
2. complete missing reference/link authorities required by migration (for example Employee/Technician/Truck linkage) without changing inventory truth;
3. stand up target PostgreSQL/Render adapters/commands;
4. run parity tests and connected scenarios;
5. reconcile copied data/evidence;
6. cut reads and writes to one target authority;
7. run real-persona acceptance;
8. retire the old technical path;
9. only then consider separately authorized business enhancements.

A platform-reset PR that combines steps 3-8 with an unapproved business-behavior change **fails this fence**.

---

## 9. Program interpretation

For Parts / Inventory / Truck, **"done" business behavior is preserved; technical debt is migrated underneath it.**

The convergence program is successful only if a user who performs the same legitimate operational action before and after the cutover gets the same business result, while EOS gains the target architecture: PostgreSQL persistence, Render/EOS command authority, Authorization v2, zero Firebase, and common web/PWA/mobile clients.
