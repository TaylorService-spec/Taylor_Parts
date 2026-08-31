# Workstream 2A.1B — physical-root company write authority: the measurement

**Status:** MEASUREMENT ONLY. Nothing designed, nothing built, nothing written. The ruling was
explicit that this must not assume an assignment callable is required, that the migration machinery
is the right writer, that `mobile_locations` needs the same change, that assignment and reassignment
are the same act, or that sandbox and production need the same operator surface. Each is measured
below rather than assumed.

**Measured at:** `origin/main` @ `4f890ebb` (2026-08-31), after 2A.1A landed.

**The question.** A Warehouse can now HOLD `operatingCompanyId`. Nothing may PUT IT THERE.

---

## A correction I owe first: `mobile_locations` DOES have an erase path

In the 2A.1 measurement I recorded that `mobile_locations` "never had this problem" because its
reader checks required fields rather than enforcing a closed allow-list. **That was true of the
reader and false of the writer**, and the distinction matters more than the similarity.

```
mobileLocationToFirestore(s)  ->  { locationId, type, displayLabel, active, ...meta }   // fixed list
stageUpdateLocation(txn, s)   ->  txn.set(locRef(...), mobileLocationToFirestore(s))    // FULL REPLACE
```

A truck-registry update therefore **replaces the whole document from a fixed field list**, so a
company stored on a mobile location would be silently erased — the same class of defect 2A.1A closed
for warehouses, arriving through the other half of the pair. The two roots are not "one blocked, one
fine"; they are blocked in **different halves**:

| | reader tolerates the field? | writer preserves it? |
|---|---|---|
| `warehouses` | NO (fixed in 2A.1A) | YES — narrow field updates |
| `mobile_locations` | YES, always did | **NO — full-document replace** |

This does **not** mean `mobile_locations` needs the same change. It means the question "does it need a
change" has a different answer than the reader alone suggested, and belongs in this workstream's scope
decision rather than being closed by my earlier sentence. The truck callables that reach
`stageUpdateLocation` are exported from `index.ts` (unlike the warehouse writer), so this path is
closer to live than the warehouse one ever was.

---

## 1 — Is an assignment callable required?

**Not established, and the evidence points the other way for the immediate need.**

The five sandbox warehouse roots are named in `config/ownership/operating-company-roots.sandbox.json`
as **authored configuration** — R-1 was explicit that they are not inferred and that no code may infer
them. Applying twelve authored decisions to twelve documents once is an operator act, not an
application feature. Nothing in the product asks a user to assign a warehouse's company.

The repository already distinguishes these two shapes:

- **operator CLI** — `warehouseGovernanceMigrationCli.js`: dry-run by default, `--execute` requires
  `--acknowledge-production-write` AND a manifest AND an Owner-approved `--manifest-sha256` content
  pin; re-reads live state, recomputes fingerprints, stages in one transaction, verifies, and
  publishes evidence atomically only after a passing verification.
- **application command** — a capability-gated callable, for something users do repeatedly.

A callable would be required if warehouse-company assignment is a thing the business does over time
(new sites, acquisitions, reorganisations). It is not required to unblock 2B, and building one to
unblock 2B would be the "invent an authority to unblock a workstream" pattern that 2C was explicitly
protected from.

## 2 — Is the existing migration machinery the correct writer?

**It is the best-guarded operator surface in the repository, and it is the wrong job.**

`executeMigration` exists to **initialize governance** on legacy records — it derives `status` from a
legacy `active` flag, stamps `provenance: MIGRATED`, and writes `governanceInitializedAt/By`. Routing
company assignment through it would mean either (a) re-running a governance migration on already-
governed records purely to add a field, which its own GOVERNED-is-a-no-op design deliberately
prevents, or (b) adding an assignment mode to a tool whose evidence, manifest and verifier all
describe governance initialization. The second would make its evidence lie about what it did.

What is worth **reusing** is its *shape*, not its code path: dry-run default, an Owner-approved
manifest bound by content hash, live re-read with fingerprint comparison, one transaction, verify
before publishing evidence.

## 3 — Creation-time only, or controlled assignment to legacy roots?

**Both are needed, and they are not the same act.** Every existing warehouse is a legacy root with no
company; there is no creation path in production to attach it to (`createWarehouse` is inert and
unexported). So a creation-time-only rule would leave all twelve sandbox roots permanently unassignable
— it answers a question nobody is asking yet while leaving the actual one open.

## 4 — Are assignment and reassignment equivalent?

**No, and the repository already says so.** `ownershipMatrix.ts` records the warehouse root as
`transfer: "HANDOFF"` — deliberately distinct from the `IMMUTABLE` used for derived families. So:

- **unset → company** is a first assignment. No authority exists for it.
- **company → different company** is an ownership change, which the matrix already routes to the
  **handoff** authority (`ownershipHandoffCommand.ts`, inert, one record, one event, no cascade).

Treating them as one act would either give the handoff authority a job it was not designed for
(there is no `previousOwner` on a first assignment) or give an assignment tool the power to move a
company, which is the thing the handoff authority exists to make explicit and auditable.

**Expected direction from the ruling maps cleanly onto this:** unset → valid company is a controlled
one-time assignment; same company is idempotent; a **different** company is REFUSED *by the assignment
path* — and reachable only through the handoff authority, when that is activated.

## 5 — Who may perform it?

**No capability exists today.**

- `inventory.warehouse.status.set` is referenced **by string only** in `warehouseStatusWriter.ts`; it
  is not in `permissionCatalog.ts` and is granted to nobody. Its own comment says registering and
  granting it are separate later gates.
- There are **no `ownership.*` capabilities** in the catalog at all.

So any application-command answer to 2A.1B requires a new capability, its registration, and a grant —
three gates, none of which exist. An operator-CLI answer requires none of them, because the operator's
authority is the Admin SDK credential plus the Owner's approval of a manifest.

## 6 — Immutable after assignment?

Not per the matrix — `HANDOFF`, not `IMMUTABLE`. The practical requirement is narrower and stronger
than "immutable": **no ordinary Warehouse writer may change it**, which 2A.1A already asserts
(exact-key allow-lists, a four-field status update, and Rules denying every client write). What
remains open is whether the *assignment* path may overwrite a different company, and §4 argues it
must not.

## 7 — Required audit event?

`OWNERSHIP_HANDOFF` exists in both the `AuditAction` union and the runtime array, with
`OWNERSHIP_HANDOFF_SOURCES`. There is **no** warehouse-company-assignment action.

Whether a first assignment reuses `OWNERSHIP_HANDOFF` is a real question, not a formality: a handoff
event carries `previousOwner`, and a first assignment has none. Recording "handed off from nothing"
would make the ownership audit trail describe an event that did not happen.

## 8 — Idempotency and mismatch

The repository has a strong precedent to reuse rather than reinvent: the reorder commands bind an
idempotency key to a **command fingerprint**, so a replay with the same payload replays and a replay
with a different payload is REFUSED rather than silently treated as the original. Applied here: same
company → idempotent no-op; different company → refuse, do not overwrite.

## 9 — Sandbox versus production operator surface

**They do not need the same surface, and the repository already treats them differently.**

- `ownershipSandboxBackfill.js` is **sandbox-or-nothing**: it refuses `taylor-parts` by name, refuses
  any registry role other than `sandbox`, refuses an unknown project, and refuses a project with no
  role — every branch a refusal.
- `warehouseGovernanceMigrationCli.js` is **production-capable under ceremony**: dry-run default,
  `--acknowledge-production-write`, and a manifest content-hash pin.

The five sandbox roots need the first shape. A production assignment — if it is ever authorized — needs
the second. Building one surface for both would either over-arm the sandbox tool or under-guard the
production one.

## 10 — Should the two roots share one assignment authority?

**Open, and §0 changes the balance.** Both are `COMPANY` roots with identical matrix rows
(`ownerClass: COMPANY`, `transfer: HANDOFF`, `inheritanceSource: "none -- this IS the root"`,
`backfillSource: "explicit governed configuration"`), and R-1 assigned seven mobile locations
alongside the five warehouses in one ruling.

Against sharing: their storage authorities are entirely different — a §3A validator with a closed
allow-list versus a required-field reader with a full-replace writer. A shared authority would have to
straddle both, and the erase path in §0 would have to be closed first regardless.

---

## What would have to be true before any of this is built

1. A decision on **whether the immediate need is an operator act or an application capability** (§1).
2. If operator: which of the two existing guard shapes (§9), and whether `mobile_locations` is in
   scope for the same run (§0, §10).
3. If application: a new capability, registered and granted (§5).
4. A decision on the **audit action** for a first assignment (§7).
5. Closing the `mobile_locations` erase path **before** any company is written to a mobile location —
   the same absolute ordering rule 2A.1A established for warehouses, for the same reason (§0).

**Nothing above is a recommendation to build.** The one thing this measurement does assert is §0: the
`mobile_locations` full-replace writer is a live erase path, my earlier sentence about that root was
half wrong, and the correction belongs on the record before anyone plans around it.
