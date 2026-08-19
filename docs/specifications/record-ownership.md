---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-08-19
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Sprint Specification: <sprint name>

**Architecture Review:** <link> — Approved YYYY-MM-DD

## Executive summary

Record ownership exists in this system today as scattered fields with no governing rule. Accounts
carry `accountOwner.assignedToEmployeeId`; Opportunities and Sales Orders carry
`ownerEmployeeId`; Contacts, Locations and Parts carry nothing. Nothing states who becomes owner,
whether ownership can move, or what owning a record actually entitles you to.

That was tolerable while nothing depended on it. It stopped being tolerable when the Owner ruled
that a sales role exports only what it owns ([admin-data-console.md](./admin-data-console.md)) —
export scoping would silently inherit whatever those fields happen to contain.

**The model (Owner, 2026-08-19), in three sentences:**

1. **Whoever creates a record owns it.**
2. **Ownership can be transferred to someone else.**
3. **Parts and inventory are owned by the system** — they have no human owner.

## A defect this exposes, worth fixing before anything is built on it

`createSalesOrderFromOpportunity.ts` takes `ownerEmployeeId` as **caller-supplied**, validated
only as a non-empty string (line 232). It is never checked against the authenticated actor and
never checked to be a real Employee.

Under "whoever creates it owns it" that is simply wrong. Combined with owner-scoped export it is
worse than wrong: a caller can name **any** employee as owner at creation — assigning records to
themselves, or away from themselves, with no transfer event and nothing in the audit trail
distinguishing it from a legitimate creation.

The same shape must be checked wherever else an owner field is accepted from input.

## Sprint objective

Define record ownership as a governed, uniform concept: how it is assigned, how it moves, what it
means, and which objects are exempt — so that features which scope by ownership have something
real to scope against.

## Scope

### 1. Ownership is assigned, never claimed

The owner of a new record is **derived from the authenticated actor**, resolved to their canonical
`employeeId`. It is not an input field. A create command that accepts an owner from the caller is
a defect, not a feature.

Where a record legitimately needs to belong to someone other than its creator — a coordinator
opening an Opportunity on a rep's behalf — that is **creation followed by an explicit transfer**,
producing both events. The audit trail should show what actually happened rather than presenting
an assignment as if the rep had created it themselves.

### 2. Transfer is explicit, governed and audited

A dedicated transfer command per ownable object, not a field update through a generic writer:

- records **from**, **to**, **who transferred**, **when**, and optionally **why**
- writes a distinct `AuditAction` (`transferRecordOwnership` or per-object equivalent) so
  "who reassigned this account, and when" is answerable without diffing document history
- validates the new owner is a real, **active** Employee — reassigning to a departed employee
  orphans the record silently, which is how ownership models rot
- is capability-gated (see §5), and may be constrained per object

### 3. Ownership is not permission

**Owning a record confers no capability.** Ownership *scopes* a capability the principal already
holds; it never supplies one. Someone with no export capability who owns a hundred accounts still
cannot export. Someone with export capability, scoped to their own records, exports those hundred.

This separation is the same one this platform already draws between security authorization and
operational qualification, and it is what keeps ownership from quietly becoming a second, parallel
permission system.

### 3.1 An owner is always an Employee. A Contact is a customer, and owns nothing

Stated explicitly because "contact" and "owner" appearing in one document invites the wrong
reading, and because the distinction is load-bearing for every rule below.

- An **Employee** is one of ours. Employees own records.
- A **Contact** is a person at the customer — related to an Account, never employed by us. A
  Contact **owns nothing**. Contacts are among the things that are *owned*.

The data model already separates these, and enforces it:

| Field | Points at | Meaning |
|---|---|---|
| `accountOwner.assignedToEmployeeId` | **Employee** | who owns this Account |
| `billingContact.contactId` | **Contact** | which customer person is billed |

Those live side by side on the Account document and are deliberately different types.
`domain/commercialProfile.js`'s `isContactOnAccount()` already rejects a contact id belonging to
another Account, so a Contact's relationship to its Account is enforced rather than assumed.

So when this specification says a Contact is *derivatively owned*, it means: the Contact record is
owned by the **Employee who owns the Account the Contact is related to**. It never means a Contact
owns anything, and a Contact is never a candidate value for an owner field. A create or transfer
command that accepted a `contactId` as an owner would be a type error, not a policy choice.

### 4. What is ownable, and what is system-owned

| Object | Ownership | Field |
|---|---|---|
| Account | owned | `accountOwner.assignedToEmployeeId` (existing) |
| Opportunity | owned | `ownerEmployeeId` (existing) |
| Sales Order | owned | `ownerEmployeeId` (existing, currently caller-supplied — see above) |
| Work Order | owned — **open question**, see below | — |
| Contact | **derivative** — owned by the Employee who owns its related Account | none of its own |
| Location | **derivative** — owned by the Employee who owns its related Account | none of its own |
| Part | **system** | none, by design |
| Inventory records | **system** | none, by design |

**System-owned means ownership is not the access control for that object.** Parts and inventory
belong to the business, not to a person. Access to them is governed by capability alone —
`inventory.catalog.manage`, `inventory.transaction.read` and so on. There is no owner field to
populate, no transfer, and no owner-scoped filtering.

This matters for the export ruling: a sales role's export of Parts is decided by whether it holds
the capability, **not** by ownership. The earlier draft of the console spec guessed that sales
would export zero Parts because they own none; under this model that reasoning is wrong, and the
correct answer is that ownership simply does not participate.

**Derivative ownership has a consequence worth stating**: reassigning an Account moves its
Contacts and Locations with it, immediately and silently. That is almost certainly the desired
behaviour — they are the customer's people and places, not the rep's — but it means an Account
transfer is a larger act than it appears.

### 5. Capability

- `record.ownership.transfer` — perform a transfer.
- Whether a principal may transfer a record they do **not** own is a separate question from
  whether they may transfer one they do. Proposed: owning it is not sufficient on its own; the
  capability governs, and admin holds it.

### 6. Backfill

Existing records predate this model and have no owner or an unvalidated one. They are **not**
retroactively assigned to whoever happens to have created them — creator identity is not reliably
recoverable, and guessing produces a confident, wrong answer.

Unowned existing records stay unowned and are visible to capability-holders whose access is not
owner-scoped. Assigning them is a deliberate operator action with a dry-run manifest, following
the pattern the provisioning and backfill CLIs in this repo already establish.

### 7. Stored identity vs displayed identity

**Stored: `employeeId`. Displayed: the employee's name. Never the reverse, and never the raw id.**

The owner field holds the canonical `employeeId` — a foreign key to the Firestore employee
document — because a name is not an identity: people are renamed, two can share a name, and a
display string cannot be joined on. Every ownership comparison, filter and transfer operates on
the id.

What a person sees is the resolved name. This is not a new rule; it is the existing **F-UID-1**
invariant that already governs actor identity across this product:

- `domain/actorDisplayName.js` is the dependency-free resolver, and its stated invariant is that a
  raw Firebase UID must **never** reach a non-admin DOM.
- When a name cannot be resolved it renders `UNKNOWN_ACTOR_DISPLAY_NAME` — **never the raw id as a
  fallback**. An unresolvable owner is honestly unknown, not silently rendered as a hex string.
- DECISIONS #106 states the same principle for business references: a missing reference is not
  permission to display a record id.

Ownership follows that contract rather than establishing a parallel one. Concretely:

- The owner is rendered through the existing resolver, not by reading the id into a label.
- An owner that cannot be resolved reads as unknown, and the record still reads as **owned** —
  "unknown owner" and "no owner" are different states and must not collapse into one.
- The authorized admin user-management surface is the documented exception that may show raw ids;
  ordinary record surfaces, including the owner field, may not.

**Two joins, one authority.** `employeeId` is the ownership key, but the authorization resolver
works in Firebase `uid`. The mapping between them lives in the employee/user records, and
owner-scoped filtering has to perform that join **server-side** — a client cannot be trusted to
assert which employeeId it is. That join is where owner-scoped export is either correct or a hole,
so it belongs in the governed read service and nowhere else.

## Explicitly out of scope

- **Team, territory and coverage rollup.** Whether a sales manager can see their team's records is
  the Commercial Coverage & Territory requirement the Owner explicitly deferred ("record and
  preserve the seams, do not build during the runway"). This specification defines *individual*
  ownership only. A manager owns what they own personally, and nothing more, until that model
  lands. Building a rollup here would construct the deferred territory model by accident.
- **Sharing / grant-to-another-user.** Ownership is singular here: one owner at a time. Sharing a
  record with a second person without transferring it is a different feature.
- **Ownership-based Firestore Rules.** Enforcement stays in the governed services, matching the
  existing precedent for saved report definitions.

## Firestore Rules impact

None expected. Ownership is enforced in governed read and write services, not in client-direct
Rules — consistent with how saved report definitions already work.

## UI impact

- **The owner is visible on the record**, and is a name rather than an employee id.
- **Transfer is an explicit action** with a confirmation that names both parties and, for an
  Account, states plainly that its Contacts and Locations move too.
- A record with **no owner** reads as unowned — not blank, and not attributed to whoever happens
  to be looking at it.

## Testing strategy

- A create command never accepts an owner from input; the owner always resolves to the actor.
- Transfer to a non-existent or inactive Employee is rejected.
- Transfer writes its audit event with from, to, actor and timestamp.
- Owning a record confers no capability: a principal without export capability who owns records
  still cannot export.
- System-owned objects have no owner field and no transfer path.
- Account transfer moves the owner-scoped visibility of its Contacts and Locations.

## Rollback strategy

The model is additive: owner fields already exist and are not being repurposed. Disabling transfer
leaves ownership static; disabling owner-scoped filtering falls back to capability-only access,
which is today's behaviour. Nothing here rewrites existing data — see Backfill.

## Acceptance criteria

1. Every ownable record created after this change has an owner derived from the authenticated
   actor, and no create command accepts an owner from the caller.
2. `createSalesOrderFromOpportunity`'s caller-supplied `ownerEmployeeId` is closed.
3. Ownership can be transferred through a dedicated governed command, capability-gated, which
   writes an audit event naming from, to, actor and time.
4. Transfer to an inactive or non-existent Employee is rejected.
5. Owning a record grants no capability by itself.
6. Parts and inventory have no owner field, no transfer path, and no owner-scoped filtering.
7. Transferring an Account moves owner-scoped visibility of its Contacts and Locations, and the
   confirmation says so before it happens.
8. Existing unowned records are not retroactively attributed to anyone.

## Open questions

1. **Are Work Orders ownable?** They already carry `scheduledTechId` and `assignedTechId`, which
   are *assignment*, not ownership, and conflating them would be easy and wrong. A Work Order
   plausibly has no owner in the sales sense — it belongs to the dispatch process.
2. **Can a non-admin transfer a record they own?** Letting a rep hand off their own account is
   natural; letting them push an unwanted one onto a colleague is not.
3. **What happens on employee deactivation?** Their owned records need to go somewhere, or they
   become invisible to every owner-scoped query while remaining visible to admin. This is the
   most likely way the model rots in practice, and it interacts with the deferred territory work.
