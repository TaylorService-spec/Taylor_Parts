# ADR-015: The EOS Data Plane Is An Implementation, Not The Domain Contract

- **Status**: Accepted
- **Date**: 2026-09-04
- **Context**: EOS Data Import P1 (Owner direction, unified). The ruling itself is Owner's;
  this record states it, and states what the first feature built under it actually did.

## The ruling

EOS does **not** require every customer to keep operational data in Verenward's Firebase
project. Three deployment models are in scope for the platform:

1. **Verenward-hosted** — the customer's operational data lives in a Verenward-operated
   Firestore project. Every environment today is this one.
2. **Customer-hosted** — the customer keeps operational data in their own database, under
   their own control, with EOS operating over it.
3. **Enterprise adapter** — EOS operates over a system of record the customer already has.

Therefore:

> Firestore is **a supported EOS data-plane implementation**.
> It is **not the EOS domain contract**.

## Why this needed writing down

A codebase gets this wrong quietly rather than loudly. Nobody decides that a document shape
is the domain model; it happens one file at a time, because the fastest way to write a rule
is next to the query that feeds it. By the time it matters, "what a Part IS" and "what a Part
document LOOKS LIKE" are the same paragraph, and separating them means touching everything.

The cost is not portability alone. A domain rule written against a document is a rule you
cannot test without a database, cannot read without knowing the storage, and cannot change
without a migration — regardless of whether a second data plane ever exists.

## What this does NOT mean

- **It is not a mandate to abstract Firestore behind an interface.** A repository interface
  with one implementation is a cost with no benefit, and this ADR does not ask for one.
- **It is not a reason to remove existing client writers.** Accounts and Equipment are still
  written client-direct under `firestore.rules`. That is a documented interim, and changing
  it is a separate decision with its own review. Data Import added trusted paths *alongside*
  those writers and removed nothing.
- **It is not a repo-wide refactor.** Nothing already written was moved to satisfy it.
- **It is not a promise that a second data plane is coming.** It is a statement about where
  a rule belongs, which is worth honouring whether or not one ever does.

## What it does mean, concretely

A module that decides **what something means** must not also know **where it is kept**.

The seam is drawn at exactly one place: the point where a decision needs stored state. Above
that line, state arrives as a **value** — a set, a map, an injected function. Below it,
somebody reads a database.

## The worked example: Data Import P1

Data Import was the first feature built under this ruling, and it is the reference for what
the ruling costs and buys.

### Above the line — no `firebase-admin`, no collection names

| Module | What it owns |
| --- | --- |
| `contracts/entityContract.ts` | the registry: an entity contributes fields, normalization, identity |
| `contracts/*ImportContract.ts` | what a Part / Customer / Equipment / Opening Balance / Service Record IS |
| `importIntake.ts` | parsing, entity detection, column mapping, drift |
| `xlsxReader.ts` | reading a workbook (node `zlib` only) |
| `importPreview.ts` | row classification, duplicate policy |
| `importJob.ts` | the job lifecycle and what may execute |
| `importExecution.ts` | walking approved rows over an **injected** writer |

`importPreview.ts` has no write capability of any kind. That is what makes "nothing is written
before approval" a structural property rather than a promise — there is no write path to hold
back. `importExecution.ts` cannot write either, and cannot be made to by editing it: whatever
authority exists lives in the function passed in.

Existing identity reaches preview as a `ReadonlySet` of keys. Foreign keys reach it as an
`ImportContext` of reference sets. Neither is a query.

### Below the line — the Firestore implementation

`firestoreDataImportAdapters.ts`, `firestoreInventoryImportAdapters.ts` and
`firestoreServiceHistoryAdapters.ts` are the whole of it: which identities exist, where jobs
are kept, and how one record is actually written. Each entity contributes two functions to
one table in `dataImportCallables.ts`, and everything between parsing and accounting is shared.

### The rule that made it real

**Import has no write authority of its own.** It authorizes nothing a person could not have
done one record at a time, and it holds no capability that exists only to let it write. That
is the rule; the four operational entities and the fifth historical one satisfy it differently,
and the earlier wording — *"every writer calls the governed command that already owned the
record"* — was true of four of them and not of the fifth. Stated accurately:

| Entity | Executes through | Authority |
| --- | --- | --- |
| Parts | `partMaster`'s `createPart` — pre-existing, unchanged | `inventory.catalog.manage`, enforced by that command |
| Customers | `createAccountFromImport`, a trusted command written for this feature | `customer.record.create` — the existing catalogued authority |
| Equipment | `createEquipmentFromImport`, likewise | `equipment.install` — the nearest existing authority, reused, widening nobody |
| Inventory | `applyOpeningInventoryBalanceThroughTxn` over the existing operational ledger | the ledger's own primitives; no second balance authority |
| Service History | the Data Import execution boundary itself | `admin.dataImport.execute` |

**Imported Service History is the honest exception, and it is not a Work Order authority.**
It is a new, import-only historical record type, written only by the trusted Data Import
execution path and its audit path. No pre-existing command owned it because no such record
existed, and no domain command was borrowed to pretend otherwise: `workOrder.create` would
have implied these ARE Work Orders — the exact confusion the record type exists to prevent.
A capability was NOT invented to make the sentence above tidier, because the authority model
does not require one: this record type has exactly one writer, no screen writes it, and no
lifecycle acts on it, so the authority to write one IS the authority to execute an import.
Reading it back is a separate, ordinary product read gated on `customer.record.read`.

Where a trusted command had to be written (Accounts and Equipment are still client-direct
under Rules, and the Admin SDK evaluates no Rules), the command **re-states every guarantee
that Rules block makes** — the writable-key allow-list, the governed create baseline, the
derived `nameLower` search key, the referential rule re-read inside the transaction, and the
correct timestamp type. A test asserts the equipment key list equals `firestore.rules`' own,
and a Rules-emulator suite proves an imported machine stays editable through the ordinary
client path while its server-derived key stays unforgeable, unmodifiable and undeletable.

### Making imported history visible without making it a Work Order

A record nobody can reach is not a record. Imported history is read back through a trusted
callable and rendered as a **second, separately-headed source** under a customer's Service
activity — beside the Work Order timeline, never interleaved with it, and never counted into
the Work Order counts.

Not merged into one chronological list, deliberately. A Work Order row carries a status, a
schedule and an assigned technician; an imported row has none of those and never will.
Interleaving them would put empty cells beside every historical row and invite exactly the
reading this must prevent — that those are jobs EOS lost track of.

The read resolves nothing. The technician name and the equipment serial are returned as the
historical text they were stored as, labelled *as recorded*. Joining either to a current
Employee or a current Equipment record would manufacture a link the canonical model does not
prove, inside a record that reads as authoritative.

### What it cost, honestly

- Two extra function calls per entity (`loadExisting`, `writer`) and one indirection.
- Two casts at the registry seam, where a draft is `Record<string, unknown>` rather than each
  entity's own type — because the registry cannot name every contract without depending on
  every contract, which is the cycle it exists to avoid.
- Duplicated glue: `normalizeAccountSearchName` exists on both sides of the client/server
  line, as every other pair in this repo does, because there is no shared-module tooling and
  widening the Functions rootDir changes what `firebase deploy` packages. A test executes the
  client's own function and asserts they agree character for character.

### What it bought, immediately and not hypothetically

- Every domain rule is tested with no database: 164 offline tests, seconds.
- Five entities share one pipeline. Adding one is a contract file plus a row in a table.
- A defect surfaced that document-shaped code would have hidden: the opening-balance command
  accepted a **second** opening balance at a position that already had one, stacking them.
  Found by an end-to-end test asking what the ledger actually contained.

## Consequences

1. **New domain logic goes above the line.** If a rule needs stored state, the state is
   injected as a value and the reading happens in an adapter.
2. **Adapters may name collections. Nothing else may.** Enforced per feature by tests that
   read the source and assert no `firebase-admin` import and no `.collection(` appears above
   the seam.
3. **A trusted command that bypasses Rules must re-state them.** The Admin SDK evaluates no
   Rules, so any guarantee a Rules block makes is a guarantee that command now owes.
4. **This ADR does not authorize a migration.** No existing module is moved to comply. It
   governs what gets written next.

## Open, and deliberately not decided here

- Whether EOS's derived Service History view should union imported records with Work Orders.
  That changes what "service history" means and what every report over it counts.
- Whether Equipment deserves its own create capability rather than reusing `equipment.install`.
- Whether the Verenward-hosted data plane should ever be reached through a declared interface
  rather than by convention. Today the convention is enforced by tests, which is cheaper and
  has caught everything it was pointed at.
