# CERT-FIN-02 — Accounting Policy Framework: implementation reconciliation

**Status:** IMPLEMENTED at platform level. No production deployment, no data migration, no capability
granted, no Firestore Rules change. Measured against `origin/main` at implementation time.

**Owner ruling, 2026-09-03.** EOS does not have an accounting method. It supports governed
**accounting-policy profiles**: the platform implements and tests several methods, each customer's
accounting team selects one during deployment, that selection is approved as part of the
implementation, and it **locks** when the company's financial authority is activated. A later change
is a separately governed migration (approval → effective date → impact assessment → conversion →
activation) that is deliberately **not** built.

This retires the older framing — recorded in
[`../financials/FIN-BLOCK-003_COST_AUTHORITY_DECISION_PACKAGE.md`](../financials/FIN-BLOCK-003_COST_AUTHORITY_DECISION_PACKAGE.md)
and the [decision sheet](../financials/CERT-FIN-02_INVENTORY_COST_AND_COGS_DECISION_SHEET.md) — that
one permanent method had to be chosen before anything could be built. Both documents are preserved
as the history that produced this ruling; neither is rewritten.

---

## 1. The three layers, and why they are kept apart

| Layer | What it is | Where it lives | Configurable? |
|---|---|---|---|
| **Platform invariants** | Rules no customer may buy out of | `PLATFORM_INVARIANTS`, `UNKNOWN_COST_TREATMENT` | **No.** Constants and screen statements — never fields, never dropdowns |
| **Supported strategies** | What the engine actually implements and tests | `INVENTORY_COST_METHODS`, `SERIALIZED_COST_METHODS`, `COGS_RECOGNITION_POINTS` | No — a method absent here cannot be selected, because selecting it would promise arithmetic that does not exist |
| **Deployment choice** | One company's approved profile | `financial_policy_profiles/{operatingCompanyId}` | **Yes, once.** Then locked |

A dropdown whose only other option is forbidden is not a choice; it is an invitation to ask for the
forbidden one. That is why `unknownCostTreatment` is **not** a profile field — the validator refuses
the key outright, and a test proves it.

## 2. Platform invariants, and the guard for each

| Invariant | Enforced by |
|---|---|
| UNKNOWN cost is never zero | `CostFigure` has **no `amountMinor` on the UNKNOWN branch** — a nullable number invites `?? 0`, and that one character is how UNKNOWN becomes zero. Asserted for every method |
| Historical facts are not rewritten | The command imports nothing that can write an acquisition-cost fact; an emulator test proves configuring a policy leaves `inventory_acquisition_costs` untouched |
| Internal transfer manufactures no cost | Unchanged from DECISIONS #164 ruling 19; the engine reads lots, and only a receipt creates one |
| Operating-company partition | `poolIdentity` refuses a mixed-company pool outright rather than summing it — enforced in the engine, not trusted to the caller's query |
| Integer minor units | Floats are **refused, not rounded** (`19.99` throws); every intermediate product is range-checked |
| Fail-closed margin | `deriveGrossMargin` still returns UNKNOWN; `COST` is still not a `FINANCIAL_SOURCE_TYPE` |
| No silent recalculation | `LOCKED` has no outbound transition in `PROFILE_TRANSITIONS`, and no unlock command exists |

## 3. Supported strategies

**WEIGHTED_AVERAGE** and **FIFO** for interchangeable inventory; **SPECIFIC_IDENTIFICATION** (plus
either pooled method) for serialized. LIFO, standard cost and replacement cost are **absent as
values** — pre-registering a name would suggest the arithmetic exists.

The worked proof, from one physical history (receive 10 @ $10.00, then 10 @ $14.00, relieve 5):

| | relieved cost | remaining value | remaining qty |
|---|---|---|---|
| Weighted average | **$60.00** | $180.00 | 15 |
| FIFO | **$50.00** | $190.00 | 15 |

Different financial answers, **identical physical answer** — asserted directly: policy must not change
how many units exist. Each method also conserves value exactly (relieved + remaining = $240.00).

**Rounding.** Weighted average rounds **once, half-up, on the relieved total**, never per unit.
Rounding a unit cost first and multiplying scatters error across every unit and leaves a residue that
never reconciles; the complement is then computed by subtraction, so pool and relief always sum
exactly. FIFO needs no rounding at all — each layer contributes `unitPrice × consumed`, exact integers.

### Specific identification: the identity already existed

No new field was added. `serialized_assets` carries `partId` + `activatedByReceivingId`
(`serializedAssetRegistration.ts`); the acquisition-cost fact carries `partId` + `receivingId` +
`unitPriceMinor`. Joining on those yields a serial's actual cost, with no schema change and no Rules
change — and `serialized_assets` has a fail-closed field allowlist, so this avoided a governed
contract change entirely.

**The known ambiguity is refused, not resolved.** One receipt, same part, two lines, different
prices ⇒ the serial maps to two lots and the engine throws `SERIAL_AMBIGUOUS`. Picking the cheaper,
the older or the first would be inventing financial lineage. **Smallest missing identity requirement,
recorded rather than guessed:** either record `receivingLineId` on the serialized asset at receipt, or
forbid two lines of the same part on one receipt. Both are small; neither was chosen here, because
choosing would be inventing the lineage rule.

## 4. Why there is no cost-pool collection

A stored weighted-average pool was the obvious build and was **not** needed. The acquisition-cost
facts *are* the layers: each already records quantity, unit price, currency, company and receipt
lineage, and each is immutable. FIFO layers are those facts in receipt order; a weighted average is an
aggregate over the same set. Both are therefore **derivable from evidence that already exists**, and a
derived number recomputed from immutable facts cannot drift from them — which a separate stored pool
absolutely can.

The one genuinely new state is **relief** (which quantity has already been costed out), and relief is
written by a recognition event, which does not exist because the recognition point is an open
accounting decision. So the engine takes prior reliefs as an **input**. No half-built pool sits in the
database waiting to go stale. If derivation later proves too slow, the answer is a *cache* of a
derivable value — a different and much safer object than an authoritative pool.

## 5. COGS recognition — framework, not a Taylor-specific event

Three governed events are available (`SALES_ORDER_FULFILLMENT`, `INVOICE_ISSUE`, `EQUIPMENT_INSTALL`).
**Physical movement is never a recognition point** — transfer, put-away, staging, receipt and cycle
count are absent, and a test enumerates them to keep it that way.

**`WORK_ORDER_CONSUMPTION` is unavailable, and the availability is DERIVED, not restated.**

The service-parts prerequisite was **re-measured mid-run**, because #1772 landed the physical
consumption authority while this work was in progress. The finding changed, and so did the
implementation:

- The movement authority now **exists** — `functions/src/workOrderConsumption/`, with a source
  resolver, a governed `WORK_ORDER_CONSUMPTION` movement, a signed correction and an on-hand
  derivation that sees all of it. The blunt old statement (*"nothing removes consumed stock"*) is no
  longer the accurate reason.
- It is **inert behind one named boolean**: `PHYSICAL_CONSUMPTION_ACTIVE = false`, blocker
  `CONSUMPTION_SOURCE_SELECTION_AUTHORITY_REQUIRED`. A technician cannot yet name the inventory
  location stock was consumed from — Rules deny them warehouse and truck reads, and no capability
  says which locations they may consume from. So `qtyUsed` still records as it always has and
  physical on-hand is still overstated.

So the conclusion holds but for a sharper reason, and `financialPolicyProfile.ts` **imports that
constant** rather than hard-coding `false`. Flipping the physical gate makes this recognition point
selectable in the same act; a second copy of that decision would be a second thing to forget. The
client mirror carries the computed reason and a parity test diffs it against the backend, so the gate
cannot flip and leave the screen lying.

It is shown as unavailable rather than hidden: omitting it reads as "EOS does not do that" instead of
"not yet". The two packages remain **uncoupled** — nothing here was built to close
[`physical-consumption-location-authority.md`](physical-consumption-location-authority.md), and the
one Owner answer that unblocks it is stated there.

**Nothing is wired to a recognition event yet.** The framework can express the choice; no event calls
the engine, and `COST` remains outside `FINANCIAL_SOURCE_TYPES`. Building the wiring is what an
approved recognition ruling authorizes.

## 6. Negative inventory

Re-measured. The two operational readers still clamp (`Math.max(onHand, 0)`;
*"floored at 0 so a malformed ledger can never produce negative sellable stock"*). **That was left
alone** — flooring a sell-side availability figure is correct, and changing customer-facing behaviour
to expose an accounting exception was explicitly out of scope.

The financial engine does **not** consume the clamped figure. Asked to relieve more than the pool
holds it throws `INSUFFICIENT_QUANTITY` rather than clamping, averaging over a smaller pool, or
inventing cost to close the arithmetic. That is the distinction the framework needs: the display may
floor, the financial engine must refuse. A test asserts it.

No new exception subsystem was built. A truthful integrity signal over the raw ledger is a separate
concern with no consumer yet, and building one now would be a subsystem in search of a caller.

## 7. Lifecycle and the lock

`DRAFT → APPROVED → LOCKED`. `LOCKED` has **no outbound transition**, no `UNLOCKED` status, no unlock
command, no force flag, no admin bypass.

**The lock is enforced by the backend, not the UI.** Every write re-reads the stored status *inside*
its transaction and calls `assertProfileMutable` before staging anything, so a crafted request, a
stale tab or a direct callable invocation all hit the same refusal. The emulator suite proves it by
sending a **well-formed request from an authorized caller** and asserting both the refusal and that
nothing was written. A test also asserts the module exports nothing named unlock/reopen/force/
override/reset.

`configure` cannot be used as a back door to activation (`status: "LOCKED"` is refused as an illegal
transition); activation is its own act, requires recorded accounting approval, and is idempotent when
replayed.

**Approval evidence is a record, not an electronic signature.** `approvedBy` is the accounting-team
member's name as supplied during deployment; `recordedByUid` is the EOS principal who entered it —
the only identity EOS can vouch for. The two are kept apart deliberately, and no cryptographic or
legal attestation semantics were invented.

## 8. UX

**`Administration → Financial Policy` (`/administration/financial-policy`) is the ONE editing
surface.** Financials carries a read-only summary in *Financial Settings & Governance* that links
there and contains no `<select>`, `<input>`, `<button>`, `onChange` or `onSubmit` — asserted by
scanning the section. Two places to change an accounting method is two places for them to disagree.

The screen shows only methods EOS implements, states the platform invariants as sentences rather than
controls, shows the blocked recognition point with its reason, and renders the governed locked message
with no unlock affordance. A **mirror-parity test** diffs the client's vocabulary against the server's,
so the screen can never offer a method the engine lacks or hide a block the backend enforces.

Both capabilities are registered `active: false` and granted to no Role, so the page renders its
honest ungated state today — stated plainly rather than dressed up as "no policy configured", because
an empty policy and a refused read look identical to an operator and only one means the company still
needs configuring.

## 9. No Taylor-hardcoding

No branch, constant or condition binds a customer to a method. A test greps the validator and the
engine for customer names and fails if one appears. Taylor's profile is a row in
`financial_policy_profiles`, not a line of code, and a different deployment selects a different
supported profile with no source change.

## 10. Governance status

**`BLOCKED_GOVERNANCE — FINANCIAL POLICY CONFIGURATION WRITE AUTHORITY.`**

No existing capability owns deployment-time company financial configuration. `finance.*` is AR
transaction and visibility authority; `admin.*` is users, roles and credentials. So two capabilities
were **registered** — `financialPolicy.profile.read` and `financialPolicy.profile.configure` — both
`active: false` and granted to **no Role**, following the repository's own precedent (bins, receiving,
cycle count, coverage): *register ≠ grant ≠ activate*.

**No authority was created.** `financial_policy_profiles` has no `firestore.rules` match block, so it
is deny-all to every client; the only write path is the trusted Admin-SDK command; and an ungranted
capability means the surface is inert rather than merely hidden. The generated governance artifacts
record both as `active: false · UNCLASSIFIED — no recorded decision either way`, which is the honest
state and was regenerated rather than hand-edited.

**One nuance the Owner should have before granting.** Admin holds the capability catalog by
*derivation*, so activating these two ids is not a neutral act: it would confer the configure
authority on Admin unless the grant is scoped deliberately. That is precisely the decision this item
is blocked on, and it argues for a narrower holder than "whoever can already administer users" —
company financial configuration is a different kind of authority from role administration. Recorded,
not decided.

**Owner action required:** decide which authority owns this configuration, then grant and activate.
Until then the framework is complete and unreachable, which is the correct fail-closed posture.

## 11. CERT-FIN-02 disposition

| | |
|---|---|
| **Platform capability** | **COMPLETE.** Profile authority, three costing strategies, deterministic integer arithmetic, lifecycle, backend-enforced lock, single-authority UX, parity-tested mirrors |
| **Taylor deployment profile** | **NOT YET SELECTED.** Taylor's accounting team chooses it on the Financial Policy screen during deployment |
| **Remaining accounting-team action** | Select inventory cost method, serialized method and COGS recognition point; record the approval; activate |
| **Remaining Owner action** | Grant + activate the two capabilities (§10) |
| **Still open, correctly represented** | Service-parts recognition (blocked, with reason); cost corrections and rebate/retroactive adjustments (no additive-adjustment fact type built); freight/landed capitalization (refused without an approved allocation method); opening-inventory migration (out of scope by the sheet's own boundary) |

These are different states, and the distinction is the point: the platform can correctly accept an
approved deployment configuration whenever the accounting team supplies one. It no longer waits.
