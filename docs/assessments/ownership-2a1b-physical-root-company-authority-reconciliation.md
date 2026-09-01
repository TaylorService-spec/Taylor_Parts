# Workstream 2A.1B — physical-root company assignment authority: reconciliation

**MEASUREMENT AND DESIGN ONLY.** No writer, no callable, no Rules change, no capability change, no
data written, no deployment. Nothing here is implemented.

---

## A. Base

| | |
|---|---|
| `origin/main` at branch creation | **`4f890ebbc96fc92d49b7afdf9633e384338526ea`** — *feat(warehouse)!: the company fact belongs to the canonical Warehouse shape (2A.1A) (#1647)* |
| Branch | `claude/ownership-2a1b-physical-root-company-authority`, created from that exact commit |
| Worktree at start | clean; nothing stashed, discarded or absorbed |
| Main advanced past `4f890ebb`? | No — `4f890ebb` **is** `origin/main` at measurement time |

Receiving North Star is a separate workstream. Nothing here touches it.

### A correction I owe, carried forward

The 2A.1 measurement said `mobile_locations` "never had this problem", and the SYSTEM_AUTHORITIES row
merged in #1647 repeats it. **That was true of its reader and false of its writer** — see §J. The row
is corrected in this change, because a known-false authority statement left standing is the exact
defect class RCV-G4 just closed.

---

## B. Warehouse writer inventory

Every code path capable of writing `warehouses/{id}`, measured by locating actual `set`/`update`/
`create`/`delete` calls against a warehouse reference — not by file name.

### Production / operator writers

| # | File · function | Caller | Trusted? | Authorization | Fields it can author | Can author company? | Patch or replace | Env protection |
|---|---|---|---|---|---|---|---|---|
| 1 | `warehouseGovernance/warehouseStatusWriter.ts` · `createWarehouse` | **none** — not exported from `index.ts`, no callable | trusted (Admin SDK) | injected `authorize` seam checking `inventory.warehouse.status.set` | builds the record itself from `{warehouseId, name, location}`; request keys outside that exact set are **rejected** | **No** | constructs | n/a — inert |
| 2 | `warehouseGovernance/warehouseStatusWriter.ts` · `setWarehouseStatus` | **none** — same | trusted | same capability seam, read commit-time through the txn | `txn.update` of exactly `status, version, updatedAt, updatedBy` | **No** | patch (4 named fields) | n/a — inert |
| 3 | `warehouseGovernance/warehouseGovernanceMigration.ts` · `executeMigration` (via `warehouseGovernanceMigrationCli.js`) | operator CLI | trusted | Admin SDK credential + Owner-approved manifest | whole document from `buildMigratedRecord`'s field list | **No** — but it now **preserves** an existing company (2A.1A) | **replace** | dry-run default; `--execute` requires `--acknowledge-production-write` + `--manifest` + `--manifest-sha256` content pin |
| 4 | `warehouseBackupRestoreCli.js` · restore | operator CLI | trusted | Admin SDK + `--owner-rollback-authorization` token | writes back decoded snapshot documents verbatim | **only by restoring a snapshot that already contained one** | **replace** | `--project` must be `taylor-parts`; `--acknowledge-production-write`; snapshot sha256 pin; identity-set drift check |

**Client writers: NONE.** `firestore.rules` is unconditional:
`match /warehouses/{warehouseId} { allow read: …; allow create, update, delete: if false; }`

### Fixture / seed writers (listed separately, not production)

| File | What it writes | Shape |
|---|---|---|
| `scripts/certificationWorld/emulatorBootstrap.mjs` | `wh-main`, `{merge:true}` | full ten-field NATIVE §3A shape |
| `scripts/seedTruckFleetFixtures.mjs` · `seedWarehouse` | new warehouses, skips existing | nine fields — **omits `id`**, so what it writes is not §3A-valid |
| `scripts/seedOperationsDemoData.js` | `wh-main`, `wh-satellite` | legacy `{id, name, location}` only |

**The certification world does not author warehouses.** `certificationWorld/verifyReferenceIntegrity.mjs`
*reads* them; only the emulator bootstrap writes one, and only for the emulator.

### Not warehouse writers, despite the name

`warehouseService.ts` writes `stock_locations` and `transfer_orders`.
`warehouseAssignmentProvisioningCli.js` writes `employees.assignedWarehouseIds` — the *employee* side
of warehouse scope, not the warehouse.

---

## C. Existing administration authority — **CAPABILITY GAP**

The permission catalog contains exactly three warehouse-resource capabilities, all reads:

```
warehouse.record.read          Read a warehouses record (physical warehouse site)
warehouse.stockLocation.read
warehouse.transferOrder.read
```

The catalog's own comment beside them records that no write capability exists and that writes are
Admin-SDK-internal only.

- **No warehouse write/administration capability.** `inventory.warehouse.status.set` is referenced
  **by string only** inside `warehouseStatusWriter.ts`; it is not in the catalog and is granted to
  nobody. That module's header says registering and granting it are separate later gates.
- **No location-administration capability** covering physical sites (`inventory.location.bin.manage`
  governs bins within a warehouse, not the warehouse).
- **No operating-company administration capability.** There are no `ownership.*` or `company.*`
  entries at all.
- **No UI administration surface** for warehouses.

**Report: CAPABILITY GAP.** Nothing existing semantically means "may establish a physical root's
operating company". Per the ruling I am not substituting the admin, dispatcher or WAREHOUSE_MANAGER
role for a capability — and note the *shape* of the gap: it only becomes a blocker if 2A.1B is an
application command. An operator path's authority is the Admin SDK credential plus Owner approval,
which is how every comparable governed data change in this repository is already performed (§I).

---

## D. Company authority — reconfirmed from the repository

`functions/src/ownership/operatingCompanyAuthority.ts` (mirrored client-side, parity-tested).

| Question | Measured answer |
|---|---|
| Canonical resolver | `resolveOperatingCompany(id)` → `INVALID` \| `UNKNOWN` \| `INACTIVE` \| `RESOLVED` |
| Companies today | `taylor` (TAYLOR, "Taylor Freezer of Arizona", active) · `ventana` (VENTANA, "Ventana", active) — read from the module, not from any instruction |
| Ids immutable? | The id is the stable key; `code` is a machine token and `displayName` is **descriptive only, never authority** |
| Can a company be inactive? | **Yes** — `active: boolean`, and `INACTIVE` is a distinct resolution state, deliberately not collapsed into `UNKNOWN` |
| Shape vs membership | `isOperatingCompanyIdShape` is a shape check; the ruling requires new companies to be addable without a schema change, so shape-valid-but-unseeded resolves `UNKNOWN`, not `INVALID` |
| Rules posture | `operating_companies` has **no** match block, so Firestore denies all client access by absence |

**What makes a company valid for assignment.** 2A.1A's validator accepts a warehouse whose company
resolves with a non-null `company` — which admits **`INACTIVE`** as well as `RESOLVED`. That is
deliberate for *storage* (a company deactivated later must not retroactively invalidate every
warehouse that names it). Whether *assignment* may name an INACTIVE company is a different question
and is **not settled by existing authority** — see §N.

---

## E. Warehouse root lifecycle — evidence, no choice made

**Option D first: does existing authority already define this?** Partly, and the two halves disagree.

- `ownershipMatrix.ts` classifies the `warehouse` root as `transfer: "HANDOFF"`, `ownerClass: COMPANY`,
  `inheritanceSource: "none -- this IS the root"`, `backfillSource: "explicit governed configuration,
  Owner-supplied per site or vehicle -- never the record's display name"`. So a *policy* for change
  exists: it goes through the handoff authority, not through an ordinary write.
- **But no business event is defined anywhere.** Searching DECISIONS, SYSTEM_AUTHORITIES and the
  specifications finds no case of a warehouse moving between operating companies, and no event that
  would represent it.

**Can a physical Warehouse legitimately move from Taylor to Ventana?**

**NO GOVERNED REASSIGNMENT SEMANTICS FOUND.** The matrix says *how* such a change would have to be
made if it happened; nothing says it happens, or what business event it would be. The `HANDOFF`
classification is a routing rule, not evidence of a use case, and I am not treating "technically
expressible" as "governed".

That leaves A and B as the live options, and they are **different acts on different records**:

- **A — creation-time identity.** There is no reachable creation path today (`createWarehouse` is
  inert and unexported), so A alone assigns nothing to anything that exists.
- **B — one-time post-creation assignment for legacy roots.** Every existing warehouse is a legacy
  root with no company. This is the act the five sandbox assignments actually need.

---

## F. Legacy assignment need — measured, **not written**

`config/ownership/operating-company-roots.sandbox.json` holds the R-1 assignments as **authored
configuration**, status: *"ASSIGNED by Owner ruling R-1 — configuration only, NOT applied to any
record"*.

| Root | Company | Provenance recorded in the config |
|---|---|---|
| `wh-main` | taylor | `seedSandboxBaseline` |
| `wh-north` | ventana | `seedSandboxBaseline` |
| `wh-retired` | taylor | `seedSandboxBaseline` (status INACTIVE) |
| `wh-sandbox-central` | taylor | sandbox seed |
| `wh-sandbox-north` | ventana | sandbox seed |

Plus seven `mobile_locations` — five `certificationWorld fixture`, two sandbox seed.

**Which are certification fixtures?** By the config's own provenance, **none of the five warehouses**.
Three are `seedSandboxBaseline` and two are sandbox seed; the certification-world fixtures in that file
are all mobile locations. The certification world authors no warehouse at all (§B).

**Does repository fixture authority already know these assignments?** Yes — this config file is that
authority, and two operator scripts already read it:
`ownershipSandboxBackfill.js` and `ownershipBackfillSimulation.js`. Neither writes the roots:
`AUTHORIZED_WRITE_CAPS` covers ten collections and `warehouses`/`mobile_locations` are **not** among
them. The backfill *consumes* the root company to derive `stock_locations`, `trucks`, `cycle_counts`
and `receiving_orders` — so the roots are already the input to a governed, sandbox-guarded applier
that deliberately does not author them.

**Should rebuild/seeding eventually author them?** For `wh-sandbox-central`/`wh-sandbox-north` and the
baseline three, seeding is where they come from, so seeding is the natural long-run home. But seeding
skips existing documents (`seedTruckFleetFixtures`) or merges (`emulatorBootstrap`), so seeding alone
will never assign a company to a warehouse that already exists. **A separate one-time action is
required for the records that exist today** regardless of what seeding does later.

---

## G. Idempotency / mismatch — one measured contradiction, and it is resolvable

Candidate contract: `unset + valid company → ASSIGN` · `same company → idempotent success` ·
`different company → REFUSE`.

**Contradiction found.** `ownershipHandoffCommand.ts` refuses an identical-owner handoff outright:

```
NO_OP — "previousOwner and newOwner are identical -- a handoff that moves nothing is not an event"
```

So the existing ownership authority treats same-value as an **error**, where the candidate contract
treats it as **success**. These are compatible only if idempotency is resolved *before* the handoff
authority is reached: the assignment command detects the same-value case, returns success, and emits
**no** event — which preserves the handoff authority's rule exactly rather than weakening it.

**Nothing contradicts the other two clauses.** `unset → company` is directly supported (§H).
`different company → REFUSE` is consistent with §E: with no governed reassignment semantics, an
assignment path must not be the thing that invents them.

**Recommendation: adopt the contract as the 2A.1B invariant, with idempotency resolved at the command
boundary and no audit event for a no-op.**

---

## H. Audit — the existing authority already fits, and my earlier doubt was wrong

**Correction.** The 2A.1B pre-measurement said a first assignment "has no `previousOwner` to record",
implying `OWNERSHIP_HANDOFF` might not fit. **That was wrong.** The command's contract is explicit:

```
previousOwner is required (use null when the record had no owner)
```

`null` is the designed representation of a first assignment, and the summary builder renders it as
`(none)`. So the existing authority models exactly this case.

| Item | Measured |
|---|---|
| Existing writer | `access/auditEventWriter.ts` — the one audit system; `stageAuditEventWithId` stages onto the caller's transaction |
| Candidate action | **`OWNERSHIP_HANDOFF`**, already in both the `AuditAction` union and the runtime array (D-5 symmetry) |
| Sources | `DIRECT_HANDOFF` · `CUSTOMER_HANDOFF_REVIEW` · `ADMIN_CORRECTION` — a first assignment is closest to `ADMIN_CORRECTION`, though none was written for it |
| Actor | `actorUid`, required; server-derived, never from a payload |
| Before/after | `previousOwner: null` → `newOwner: {type:"COMPANY", id}` |
| Same-value call emits an event? | **No** — and the authority already says why: *a handoff that moves nothing is not an event* |

**Do not invent a second audit system.** The one open question is whether a first assignment should
carry a distinct source token rather than being filed as a correction — see §N.

---

## I. Sandbox vs permanent command

**The two questions have different answers, and the ruling is right that they need not share a mechanism.**

**How EXISTING legacy warehouses receive their first company** → a **bounded operator action**. The
work is twelve authored decisions applied once to records that already exist. The repository has two
established shapes:

- `ownershipSandboxBackfill.js` — **sandbox-or-nothing**: refuses `taylor-parts` by name, refuses any
  registry role but `sandbox`, refuses an unknown project, refuses a project with no role. Already
  reads the root config. Already has per-collection write caps and a dry-run default.
- `warehouseGovernanceMigrationCli.js` — **production-capable under ceremony**: dry-run default,
  `--acknowledge-production-write`, Owner-approved manifest bound by content hash.

The first is the closer fit for the sandbox five: it already knows these exact assignments, and
extending its rule set is a smaller surface than a new tool. **That is an observation about fit, not a
recommendation to extend it** — adding roots to an applier whose caps were authorized as an exact
document count is itself an authorization question (§N).

**How NEW warehouses receive a company** → creation-time identity, in `createWarehouse`, whenever that
writer is activated. It already constructs the record and rejects unknown request keys, so adding
company to its accepted set is a contained change *at that time*. **Not needed now** — nothing calls it.

**A permanent application command is not established as required.** Nothing in the product asks a user
to assign a warehouse's company, and building a callable to unblock 2B would be the
invent-an-authority-to-unblock-a-workstream pattern 2C was explicitly protected from.

---

## J. `mobile_locations` — the comparison, corrected

| Question | Measured |
|---|---|
| How is its operating company established today? | **It is not.** `grep operatingCompanyId` across `functions/src/truckRegistry/` returns nothing — the truck registry has no concept of company. |
| Does it already have a writer? | **Yes, and unlike the warehouse writer it is exported.** `truckRegistryRepository.stageCreateLocation` / `stageUpdateLocation`, reached by the truck callables exported from `index.ts`. |
| Is company mutable there? | Not applicable yet — but **the writer would erase it.** `stageUpdateLocation` does `txn.set(ref, mobileLocationToFirestore(s))`, and that serializer is a **fixed field list** `{locationId, type, displayLabel, active, ...meta}`. A full-document replace. |
| Reusable physical-root authority concept? | Only the ownership matrix row, which is identical for both roots (`COMPANY` / `HANDOFF` / root / authored configuration). No shared code. |

**The two roots are blocked in different halves:**

| | reader tolerates the field? | writer preserves it? |
|---|---|---|
| `warehouses` | NO → fixed by 2A.1A | YES — narrow field updates |
| `mobile_locations` | YES, always did | **NO — full-document replace** |

**Do not widen a warehouse legacy-assignment path to `mobile_locations` on this evidence.** The
warehouse work is now *safe* and *unauthorized*; the mobile-location path is *unsafe* and would need
its own preservation fix first — the same absolute ordering rule, for the same reason.

---

## K. Production protection

`config/environments.json` roles: `platform-sandbox` and `platform-certification` are both **`sandbox`**;
`taylor-parts` is **`production`**; `platform-integration` is `integration`.

| Environment | Existing protection precedent |
|---|---|
| Sandbox (`eos-platform-sandbox`) | `ownershipSandboxBackfill.js`: role must be exactly `sandbox`; dry-run default; explicit `--apply` **and** a named confirm flag; per-collection caps enforced before any write |
| Certification (`eos-platform-certification`) | **Also role `sandbox`** — a role check alone cannot tell the two apart. The repository already learned this: the seed-authorization guard was fixed to delegate to a shared, exercised authorizer rather than re-deriving it. Any new tool must target by **project id**, not by role alone. |
| Production (`taylor-parts`) | Refused by name in the ownership applier; permitted only under ceremony in the migration/restore CLIs (`--acknowledge-production-write`, manifest hash, owner token) |
| Target unprovable | Fail closed in every existing tool: unknown project, missing role, and no role all refuse |

**No production mutation is authorized, and none is proposed.**

---

## L. The 2A.1A deployment prerequisite — traced, not inferred

#1647 changed three source files: `types/warehouse.ts`, `governedWarehouseValidation.ts`,
`warehouseGovernanceMigration.ts`. Tracing their actual consumers:

| Consumer of the changed validator | Reachable from `index.ts`? |
|---|---|
| `receivingLocationResolver` → `receiveInventoryStock` | **Yes — deployed callable** |
| `receivingLocationOptionsService` → `listReceivingLocationOptions` | **Yes — deployed callable** |
| `transferLocationResolver` → transfer + cycle-count commands | **Yes** |
| `reorderCallables` → `createReorderRequest` / `listReorderWarehouseOptions` | **Yes** (undeployed as of #1646, but exported) |
| `warehouseStatusWriter`, `warehouseGovernanceMigration` | No — inert / operator-run from a checkout |
| `serializedAsset/acquireCallableWiring` | Yes |

**Required deployment surface: Cloud Functions only.**

- **Functions — REQUIRED.** Receiving is live in `eos-platform-sandbox` (Decision #63). A live
  `receiveInventoryStock` running the **pre-amendment** validator would reject a company-bearing
  warehouse as `DESTINATION_INVALID`. Writing a company before that deploy breaks live receiving.
- **Rules — NOT required.** `firestore.rules` is unchanged by #1647 and the governed hash did not move.
- **Hosting — NOT required.** No client file changed; the client never validates the §3A shape.
- **Operator tooling — runs from a checkout**, so it carries the amendment as soon as the branch does;
  but the migration CLI must not be run against a project whose *Functions* are still behind, because
  the live consumers are the ones at risk.

**MERGED ≠ DEPLOYED**, and the erase path makes the ordering a data-safety rule: **deploy Functions to
the target project, verify, and only then write any warehouse company.**

---

## M. Proposed narrow 2A.1B contract (for ruling — not implemented)

> **Bounded operator assignment of a physical-root operating company**, sandbox-targeted, one-time.

| Element | Proposal | Grounded in |
|---|---|---|
| Shape | Operator CLI, dry-run by default; `--apply` plus an explicit named confirm flag | §I |
| Target guard | Project **id** allow-list, not role alone; refuse `taylor-parts` by name; refuse unknown/missing role | §K |
| Source of assignments | `config/ownership/operating-company-roots.sandbox.json` — already the authored authority, already read by the applier | §F |
| Scope | `warehouses` only. **Not** `mobile_locations` | §J |
| Contract | unset + valid governed company → ASSIGN · same company → idempotent success, **no write, no event** · different company → **REFUSE** | §G |
| Company validity | `resolveOperatingCompany(...).state === "RESOLVED"` for assignment (stricter than storage, which also tolerates `INACTIVE`) — **needs ruling**, §N | §D |
| Write shape | Patch `operatingCompanyId` only. Never reconstruct the document — every whole-document writer in §B is a replace, and replace is how the erase path happened | §B, §J |
| Audit | `OWNERSHIP_HANDOFF`, `previousOwner: null`, `newOwner: {type:"COMPANY", id}`, actor server-derived; no event on a no-op | §H |
| Capability | None introduced. Operator authority = Admin SDK credential + Owner-approved input | §C |
| Preconditions | Functions deployed to the target project (§L); the warehouse must already be §3A-governed |

**New warehouses** get their company at creation, inside `createWarehouse`, if and when that writer is
activated — a separate, later, contained change.

---

## N. STOP CONDITIONS / unresolved authority gaps

1. **CAPABILITY GAP (§C).** No capability means warehouse/location/company administration. Only
   material if 2A.1B becomes an application command; an operator path needs none.
2. **NO GOVERNED REASSIGNMENT SEMANTICS (§E).** The matrix routes a company change to HANDOFF but no
   business event exists. The proposal therefore **refuses** a different-company assignment. If
   reassignment is real, it needs its own ruling and its own event — not a flag on this command.
3. **INACTIVE COMPANY (§D).** Storage tolerates a company that is `INACTIVE`; whether *assignment* may
   name one is undecided. Recommend `RESOLVED`-only, but this is the Owner's call.
4. **AUDIT SOURCE (§H).** `OWNERSHIP_HANDOFF_SOURCES` has no token for a first assignment;
   `ADMIN_CORRECTION` is the closest and describes a correction, which this is not. Either accept the
   imprecision or add a source — an ownership-authority change.
5. **EXTENDING THE EXISTING APPLIER (§I).** `ownershipSandboxBackfill.js` is the closest fit, but its
   write caps were authorized as an exact document count for an exact ruling. Adding root collections
   is an authorization question, not a refactor.
6. **`mobile_locations` ERASE PATH (§J).** Its writer would erase a company, and its callables are
   exported. Not in this scope — but it must be closed before any company reaches a mobile location.
7. **CERTIFICATION vs SANDBOX (§K).** Both carry registry role `sandbox`. Any new tool must target by
   project id; a role check alone cannot distinguish them.

**Nothing is implemented. Returning for architecture ruling.**
