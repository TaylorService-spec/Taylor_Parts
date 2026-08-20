# Inventory Scanner and Governed Movement Program

**Intended repository path:** `docs/product/inventory-scanner-program.md`  
**Audience:** Product owner, architecture reviewers, and implementation agents  
**Status:** Approved product direction; implementation must reconcile every authority against current `main`

**Current verified baseline:** `main` at `590f9437`. Read
`docs/governance/parts-scanner-access-decision.md` before implementation. That
package establishes that the current Scanner has one technician-only action,
`ROLE_NAV_ACCESS` supports only the three legacy role keys, and granting scanner
navigation to Parts or warehouse personas would not create receiving, counting,
or transfer behavior.

## 1. Purpose

Build one shared, mobile-first scanner platform for Parts, warehouse, and field technicians. The scanner identifies an object and prepares an operation; it never changes inventory merely because a barcode was read.

The authoritative movement is always performed by a trusted governed command that validates the actor, capability, scope, business document, source, destination, inventory state, custody, and idempotency key.

```text
scan -> resolve -> establish context -> queue -> validate -> review
     -> confirm -> trusted bulk command -> ledger/custody/audit -> receipt
```

Do not build separate scanner engines for warehouse, Parts, and technicians. They share resolution, queues, validation, receipts, and audit behavior. Their available workflows differ by effective authority and operational context.

## 2. Non-negotiable governance

Every implementation must:

- reconcile against current source, metadata, Rules, capabilities, trusted Functions, ledger contracts, custody contracts, roadmap, `DECISIONS.md`, and open work;
- reuse existing resolver and movement authorities;
- avoid client-direct Firestore inventory writes;
- avoid creating a second inventory, ledger, serialized-asset, or numbering authority;
- distinguish proposed contracts from verified existing contracts;
- fail closed for unknown, ambiguous, stale, unauthorized, or unsupported operations;
- preserve atomicity at the business-operation boundary;
- produce truthful partial-failure results only where the domain explicitly allows independent commits;
- keep deployment, activation, grants, provisioning, seeding, and live mutation outside repository-only implementation authority.

## 3. Users and scope

Role names are product direction, not sufficient authorization by themselves. Claude must map them to exact governed role ids in current source.

| User | Intended scanner scope |
| --- | --- |
| Parts Associate | Receive, put away, pick, stage, issue, accept returns, observe counts |
| Parts Manager | Associate workflows plus discrepancy review and governed approvals where granted |
| Warehouse Manager | Transfers, handoffs, count approval, location control where granted |
| Dispatcher | Coordinate and observe staging/truck handoff; execute movement only when explicitly granted |
| Technician | Assigned truck, Work Order, installation, consumption, return, and truck-count workflows |
| Admin | Governed administrative access; never an unlogged bypass |

Every operation must additionally validate:

- exact governed capability;
- active identity/employment conditions required by the access model;
- tenant/company scope;
- `assignedWarehouseIds` when warehouse-scoped;
- assigned Work Order when job-scoped;
- authorized truck/mobile location when technician-scoped;
- source and destination eligibility;
- document and lifecycle state;
- quantity, unit, part, serialized identity, and custody rules.

### Owner decision recorded

Do **not** solve warehouse scanning by adding Parts or warehouse roles to the
legacy `ROLE_NAV_ACCESS` list. Preserve the existing technician scanner journey
while the shared platform is built.

For the first warehouse vertical slice, a Warehouse/Parts Associate should be
able to:

1. open the shared Scan workspace through governed effective access;
2. scan or select a receiving document;
3. scan multiple expected parts and serialized assets into a queue;
4. review expected versus observed quantities and exceptions;
5. select/scan the receiving or staging location;
6. submit the queue through the existing trusted receiving authority;
7. receive a truthful receipt with inventory, ledger, serialized identity,
   custody, and audit results supported by current domain contracts.

After receiving, implement put-away as the next separate vertical slice. Then
pick/stage, count observation, and transfer/handoff may follow, each only after
its trusted authority is verified. Access must be capability- and scope-driven,
not based on expanding a legacy navigation role switch.

## 4. Barcode and identifier administration

The scanner can resolve only identities registered in authoritative data.

### Part Master

Provide a **Barcodes & Identifiers** section that uses the existing identifier/alias authority. It should support, only where trusted commands exist:

- internal barcode;
- manufacturer barcode and part number;
- supplier barcode and supplier part number;
- alternate or legacy identifier;
- unit-of-measure packaging code when authoritative;
- active/inactive status;
- duplicate and ambiguity detection;
- scan-to-test resolution.

### Serialized assets

Individual serial or RFID/tag identities belong to the serialized-asset registry, not generic part aliases. Quantity is always one and duplicate tag resolution must fail closed.

### Locations

Support governed scannable identities for authoritative locations such as:

- warehouse;
- receiving dock;
- staging area;
- storage bin;
- inspection;
- quarantine;
- returns;
- scrap;
- truck/mobile inventory;
- job or customer staging.

Do not invent a parallel location catalog merely for scanning.

## 5. Shared scanner entry point

Create a discoverable **Scan** workspace for eligible users. It must be mobile-first and authorization-aware.

Support:

- hardware scanners acting as keyboard input;
- manual barcode entry;
- camera scanning only through an existing safe dependency or reviewed browser implementation;
- continuous focus after a successful scan;
- audible, visual, and vibration feedback where supported;
- clear denied, offline, unknown, ambiguous, and failure states;
- deep links or contextual launches from a Work Order, PO, transfer, Sales Order, truck, Part, or inventory location where appropriate.

The first screen offers only workflows supported by trusted backend authority and the user's effective access.

## 6. Scan session and multi-scan queue

Each workflow uses a scan session containing:

- session id and device/session context;
- actor, tenant/company, and environment;
- operation;
- source and destination;
- related business document;
- created time;
- batch id and idempotency key;
- status: `DRAFT`, `VALIDATING`, `READY`, `SUBMITTING`, `COMMITTED`, `PARTIALLY_COMMITTED`, `FAILED`, `CANCELLED`, or `EXPIRED`.

Scanning adds observations to a local queue. It does not move inventory.

Each queue entry preserves:

- stable entry id and scan sequence;
- raw and normalized token;
- resolved identity type and authoritative id;
- display label;
- part id or serialized-asset id;
- quantity and unit;
- source, destination, and related document;
- client-observed time;
- validation state and messages;
- versions/preconditions required for submission.

The queue must support:

- rapid repeated scanning;
- scan count and aggregate quantity;
- undo last scan;
- remove or correct an entry;
- clear with confirmation;
- pause/resume;
- filter warnings and blocked entries;
- retry resolution;
- recovery after refresh or temporary disconnection;
- correction without rescanning the whole batch.

### Aggregation

For non-serialized parts, repeated identical scans may increment quantity. Allow `EACH SCAN = +1` and, where appropriate, quantity entry. Aggregate only when identity, unit, operation, condition, source, destination, and business context match.

Serialized assets remain separate entries, quantity one, and can never be aggregated. A duplicate serialized scan is blocked or explicitly identified as a duplicate observation.

Context barcodes—Work Orders, locations, trucks, POs, transfers, or Sales Orders—set or confirm context rather than becoming inventory lines. Replacing context on a non-empty queue requires confirmation and revalidation.

## 7. Warehouse and Parts workflows

Expose only workflows backed by verified trusted commands.

### 7.1 Part lookup — no movement

Scan a part to view, within authorized scope:

- identity and description;
- unit of measure;
- warehouse/bin balances;
- on-hand, reserved, available, staged, and mobile quantities where authoritative;
- open purchasing, Work Order demand, and back-order context where authoritative;
- registered identifiers.

Lookup never moves inventory.

### 7.2 Receiving

Expected journey:

1. Scan/select PO or receipt context.
2. Scan parts or serialized equipment into the queue.
3. Record quantity, unit, condition, and exceptions.
4. Scan receiving or staging location.
5. Review expected versus actual.
6. Submit a governed batch.
7. Create receipt, ledger, serialized identity/custody, and audit evidence through existing authorities.

### 7.3 Put-away

Scan source staging location, queue items/assets, scan destination bin, validate, and submit. Update balances and custody only through the trusted movement command.

### 7.4 Pick and stage

Scan/select a Work Order, Sales Order, or transfer; show expected demand; scan actual items; identify missing, excess, substituted, and wrong-location items; then move them to authoritative order-specific staging.

### 7.5 Warehouse-to-truck handoff

Scan/select the staging context, truck/technician, and items. Use a two-party release/acceptance model where required:

- warehouse releases;
- technician accepts;
- custody and inventory move only at the domain-defined boundary.

Do not invent acceptance states if current authority lacks them; record that as a backend gap.

### 7.6 Warehouse transfer

Scan the transfer, source, queued items, and destination. Inter-warehouse movement should preserve `IN_TRANSIT` custody where the existing model supports it. Destination receipt and reconciliation are separate governed actions.

### 7.7 Returns

Scan/select Work Order, return, or RMA; scan returned inventory; capture condition; and route to stock, inspection, quarantine, repair, vendor return, or scrap. Do not restore usable availability before disposition authority permits it.

### 7.8 Cycle count

Scan location and observed inventory, then submit observations. Expected quantity visibility follows the recorded business decision. Discrepancy calculation is server-side. Count approval and inventory adjustment remain separate authorities where required.

## 8. Technician workflows

Technicians receive narrow, contextual movement authority—not general warehouse control.

### 8.1 Load or accept truck stock

Scan/select Work Order or transfer, scan items/assets, and confirm the assigned truck. Respect warehouse release and technician acceptance controls.

### 8.2 Issue to Work Order

Scan/select the Work Order, scan inventory, review quantity/assets, and use a trusted issue command. Assignment and truck/source custody must be verified.

### 8.3 Install or consume

Scan part or serialized asset, confirm installation/consumption, and link it to the Work Order, equipment/customer context, and custody authority. Product consumption and serialized installation must remain distinct domain operations.

### 8.4 Return unused inventory

Queue unused items/assets against the Work Order, select the return destination, record condition, and submit. Warehouse acceptance may be a second governed step.

### 8.5 Remove, recover, or RMA

Scan the installed serialized identity, capture a governed reason and condition, and create the appropriate removal, custody, or RMA event. Never silently return it to available stock.

### 8.6 Count truck inventory

Scan the truck/mobile location and observations. Technicians may observe counts; discrepancy approval and adjustments require separate authority.

## 9. Proposed capability families

The following names express intended boundaries and are not assertions that these exact capability ids exist. Reconcile and reuse exact current ids before adding anything.

```text
inventory.scan.resolve
inventory.location.read
inventory.balance.read
inventory.receiving.execute
inventory.putAway.execute
inventory.pick.execute
inventory.stage.execute
inventory.issue.execute
inventory.return.intake
inventory.transfer.ship
inventory.transfer.receive
inventory.count.observe
inventory.count.approve
inventory.adjust
inventory.return.disposition
inventory.identifier.manage
inventory.location.manage
inventory.truck.read
inventory.workOrder.issue
inventory.workOrder.consume
inventory.workOrder.return
inventory.truck.count
serializedAsset.install
serializedAsset.remove
custody.handoff.acknowledge
```

Never create capability synonyms when an authoritative equivalent already exists.

## 10. Validation and review

Validate incrementally after each scan and revalidate the full immutable request on the server.

Queue entry states include `RESOLVING`, `VALID`, `WARNING`, `BLOCKED`, `DUPLICATE`, `UNKNOWN`, `AMBIGUOUS`, `STALE`, and `UNVERIFIED_OFFLINE`.

Before submission show:

- operation and related document;
- source and destination;
- total observations;
- aggregated part lines and total quantity;
- serialized assets;
- warnings and blocked entries;
- approvals or handoffs required;
- expected result.

A blocked entry is never silently omitted.

## 11. Trusted bulk submission

Use one request envelope with:

- batch id;
- operation id;
- actor and governed target/context;
- immutable ordered entries or canonical payload;
- payload hash;
- idempotency key.

The server must revalidate authority, scope, identity, document state, availability, custody, versions, source, destination, and batch size before writing.

### Atomic batch

Default for document-coupled operations such as Work Order issue, installation consumption, receiving against one document, transfer handoff, serialized installation, and count submission. Every line commits or none does.

### Governed partial batch

Allowed only if existing domain authority explicitly permits independent groups. Each group commits atomically and returns `COMMITTED`, `FAILED`, or `NOT_ATTEMPTED`. Never present partial success as complete success, and never reapply successful groups on retry.

### Transaction sizing

The server calculates projected reads and writes, including balances, inventory documents, ledger events, audit records, custody records, business documents, and idempotency records. Enforce a conservative server-owned limit. Reject oversized atomic batches before any write. Offer a split plan only when independent splitting is domain-safe.

## 12. Idempotency and retry

Required behavior:

- same key plus same target and payload returns the existing result;
- same key plus different target or payload fails closed;
- double submission or reconnect cannot duplicate movements;
- timed-out clients can query batch status;
- stable entry/group ids support safe targeted retry;
- committed entries/groups are never replayed;
- audit identity includes the governed target.

## 13. Offline behavior

Allow local draft queueing while temporarily offline, subject to the existing client storage policy.

- Mark every entry `UNVERIFIED_OFFLINE`.
- Preserve context, order, edits, and removals.
- Never claim inventory moved.
- Never validate availability from stale cached balances.
- Re-resolve and revalidate after reconnection before enabling submission.
- Show `PENDING SYNC` until the trusted server commits.
- Never store credentials or privileged tokens in the queue.

## 14. Receipts and inventory evidence

A successful batch receipt should include:

- batch id and operation;
- actor;
- source, destination, and related document;
- committed timestamp;
- requested, committed, failed, and unattempted totals;
- quantities and serialized identities;
- per-entry/group outcomes;
- ledger/custody references;
- audit id;
- resulting business-document or inventory state.

The UI must allow the user to inspect the resulting inventory state. Print/download is added only through an existing reviewed export pattern.

## 15. Movement-event reconciliation

Potential business events include:

```text
RECEIVED, PUT_AWAY, PICKED, STAGED, RELEASED, IN_TRANSIT,
ACCEPTED, ISSUED, CONSUMED, RETURNED, QUARANTINED,
COUNTED, ADJUSTED, SCRAPPED
```

These are product concepts, not permission to add new ledger vocabulary. Map them to exact current authoritative event types. Register missing concepts as explicit architecture gaps.

## 16. UX completion standard

No scanner slice is complete without:

- a discoverable entry point;
- complete user journey;
- loading, empty, resolving, offline, denied, warning, blocked, stale, success, partial, and failure states;
- authorization-aware actions;
- accessible keyboard, touch, camera, and hardware-scanner interaction where supported;
- responsive mobile and desktop behavior;
- visual inspection;
- regression tests;
- truthful post-operation state and receipt.

Classify honestly:

- `BACKEND COMPLETE — SCANNER UX BLOCKED`
- `SCANNER UX COMPLETE — MOVEMENT AUTHORITY BLOCKED`
- `RELEASE CANDIDATE — NOT USER-OPERABLE` when deployment/grant/activation remains
- `COMPLETE` only when the authorized repository slice includes both backend and UX

## 17. Required tests

Use pure, component, integration, and Firestore-emulator tests as appropriate. Cover:

- hardware-keyboard, manual, and supported camera input;
- rapid scans and continuous focus;
- non-serialized aggregation;
- serialized non-aggregation and duplicate detection;
- context barcode behavior;
- known, unknown, ambiguous, stale, and offline tokens;
- queue correction and recovery;
- role, capability, tenant, warehouse, Work Order, and truck scope;
- quantity, unit, availability, location, custody, and lifecycle validation;
- atomic all-or-none behavior;
- governed partial groups only where allowed;
- conservative batch limits;
- same-key replay and different-payload rejection;
- timeout/status lookup and targeted retry;
- no write, ledger, custody, or audit side effect on rejected batches;
- complete evidence on committed batches;
- accessibility and responsive UX.

Tests that require an emulator must actually run against it and be reported by exit code. Clean test data and terminate emulator processes afterwards.

## 18. Implementation sequence

1. Reconcile current authorities, resolvers, roles, capabilities, locations, ledger types, commands, and existing scanner components.
2. Publish an evidence table: `REUSE`, `EXTEND`, `MISSING`, or `PROTECTED DECISION`.
3. Finish barcode/identifier administration UX against existing authority.
4. Build the shared Scan workspace and lookup-only journey.
5. Build local multi-scan queue, context handling, validation presentation, and offline drafts.
6. Expose the first safe existing movement end to end, including bulk command and receipt.
7. Add warehouse/Parts workflows one authoritative command at a time.
8. Add technician workflows one authoritative command at a time.
9. Reconcile roadmap, decisions, system authorities, sandbox promotion ledger, issues, and PRs.

Do not shallow-start every workflow. Complete and verify one vertical slice before opening the next.

## 19. Stop conditions

Stop and request an Owner decision when:

- movement authority or custody boundary is genuinely ambiguous;
- a needed operation would require changing Firestore Rules or indexes;
- a role/capability grant or activation is required;
- live data mutation, seeding, deployment, or provisioning is required;
- expected quantity visibility for blind counts conflicts with recorded decisions;
- warehouse release/technician acceptance semantics are not authoritative;
- a new ledger event would be required;
- atomicity cannot be preserved safely.

## 20. Claude handoff command

```text
Read docs/product/inventory-scanner-program.md completely before acting.

Treat it as the approved product and UX direction, not proof that proposed
capabilities, events, or commands already exist. Begin with the reconciliation
in sections 2, 9, 15, and 18. Report exact source evidence and revise the plan
to reuse current authorities. Then implement one complete vertical slice at a
time, including backend, UX, tests, documentation, and roadmap reconciliation.

Operate repository-only. Do not deploy, grant, activate, provision, seed,
backfill, mutate live data, access credentials, or change Firestore Rules or
indexes. Stop at the conditions in section 19.
```
