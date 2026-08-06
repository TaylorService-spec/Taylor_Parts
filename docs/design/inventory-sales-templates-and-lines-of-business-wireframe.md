---
artifact_type: wireframe
gate: Pre-Assessment (Wireframe for Review)
status: RECOVERED 2026-08-06 — HISTORICAL DESIGN INPUT (partially consumed). Authorizes nothing.
date: 2026-07-31
owner: Claude Code
depends_on:
  - docs/BusinessEntityModel.md
  - docs/DataModel.md
  - docs/architecture/enterprise-business-metrics-framework.md
  - docs/specifications/customer-account-business-model.md
related_adrs: []
implements: []
related_issue: null
---

# Wireframe: Inventory & Sales Document Templates + Taylor / Ventana Lines of Business

> ## Recovery note — 2026-08-06
>
> **This document was recovered from a stale local checkout, where it existed only on one machine.**
> It was never on `origin/main`, yet [`../reviews/w1-line-of-business-execution.md`](../reviews/w1-line-of-business-execution.md)
> — merged work — cites it as `design_input` (sections 3.3, 3.8). That citation pointed at a file no
> other session could read. Recovering it here restores the provenance chain; it does **not** promote
> the document to current authority.
>
> **Classification: HISTORICAL DESIGN INPUT, partially consumed.**
>
> | Section | Disposition |
> |---|---|
> | 3.3 line-of-business distinction, 3.8 Account line-of-business relationship | **CONSUMED** — built and merged by wave W1. Current authority is the shipped implementation and W1's execution record, **not** this document. |
> | 3.1-3.2, 3.4-3.7 operating-company models, intercompany flows, Ventana external sales, Controller ownership override | **NOT BUILT.** Bears on Financial Operations and Sales & CRM, both Level 1 in [`../PlatformCapabilityModel.md`](../PlatformCapabilityModel.md). Retains design value. |
> | 4.0-4.4 access modality, signature ladder, templates T1-T4 (Quote / Sales Order / Pick Ticket / Service Invoice) | **NOT BUILT.** No invoicing, quoting, or document-template capability exists. |
> | 5 gap register, 6 sequencing, 7 open Owner questions | **OPEN.** The unanswered questions still block the Assessment this wireframe was written to precede. |
>
> **Nothing here is current-state.** Where it disagrees with a merged artifact, the merged artifact
> wins. Its financial vocabulary defers to [`../architecture/enterprise-business-metrics-framework.md`](../architecture/enterprise-business-metrics-framework.md).
> Commercial architecture (C2) is deliberately deferred behind C3 Operational Readiness, so the
> unbuilt sections are **not** queued work.

**Status: WIREFRAME ONLY. This document authorizes nothing.**
No application code, no Firestore collection, no Rules change, no schema field, no index,
no migration, and no deployment is authorized, proposed as final, or implied by this file.
It exists so the Owner and ChatGPT can review *shape and field coverage* before an
Assessment is written. Per `docs/ai/workflow.md`, the next gate is an **Assessment**, not
an implementation PR.

---

## 1. What was reviewed

Four real Taylor operating documents were supplied as the source of truth for fields:

| # | Document | Purpose in the business | Process |
|---|---|---|---|
| D1 | **Service Invoice** `WO38957-1` (Culver's #710) | Bills a completed field service call — labor, travel, parts, refrigerant, fees | Service → Inventory (consumption) → Billing |
| D2 | **Sales & Security Agreement** (Stingley Management / signed quote) | Customer-signed equipment sale + security agreement — the *quote/order origination* document | Sales |
| D3 | **Sales Order / Invoice** `239164` → `I-245150` (McDonald's #35362) | Confirms and bills the equipment sale, carries serial number + warranty terms | Sales → Fulfillment → Billing |
| D4 | **Pick Ticket** `239164` (McDonald's #35362) | Warehouse picking instruction for the sales order, serial-tracked | Inventory (fulfillment) |

These four are **one chain**, not four unrelated forms:

```
   D2 Sales & Security Agreement  (signed by customer)
            │  converts to
            ▼
   D3 Sales Order  ── generates ──▶  D4 Pick Ticket  ──▶ warehouse ships serial
            │  invoices as
            ▼
   D3 Invoice (I-#)
            │  installed equipment becomes a serviceable asset
            ▼
   D1 Service Invoice  (later service events against that serial)
```

The chain is what matters architecturally: **the serial number `N6033712` on D3/D4 must be
the same object the D1 service invoice services (`M9012291`).** Today the platform has no
entity that can hold it.

---

## 2. Executive finding

**Field coverage against what is actually built today:**

| Bucket | Count | Meaning |
|---|---|---|
| Fields with a real, existing system home | ~24 | Account/Contact/Location/Work Order/Technician/Part fields already exist |
| Fields with a *specified but unbuilt* home | ~6 | e.g. `relationshipTypes`, Employee, Financial provider contract |
| Fields with **no home at all** | ~70 | Pricing, tax, labor/travel billing, warranty, serialized equipment, sales orders, quotes, invoices, pick tickets, national-account routing |

**The honest headline: these four templates cannot be produced by the current system.**
They are not "a formatting layer over existing data." Three of the four (D2, D3, D4) belong
entirely to a **Sales & Order Management capability that does not exist** in this codebase —
`docs/BusinessEntityModel.md` §2 lists Invoice and Opportunity/Quote as *Future* entities,
and §3 lists Equipment/Asset as *Future*. D1 depends on labor/travel/tax billing that
likewise has no entity.

That is a finding, not a blocker — but it means the deliverable here is a **capability
wireframe**, and the follow-on work is a multi-sprint Sales & Billing initiative, not a
template-rendering sprint. Sizing this honestly now is cheaper than discovering it mid-build.

**Financial-governance constraint that applies to every screen below:** per
`docs/architecture/enterprise-business-metrics-framework.md` and the Customer/Account
Specification, no screen may render a fabricated `$0` for a missing source, and no bare
"Sales"/"revenue" label may be used. Every dollar figure in these wireframes must trace to a
real, owned, priced line item or render as explicitly unavailable.

---

## 3. Lines of business — Taylor and Ventana

### 3.1 What is being asked

Two operating companies under common ownership:

- **Taylor** — the Taylor equipment dealership and its full service/parts/support operation. Local/regional. The support system being built.
- **Ventana** — a **national accounts** business. Separate company, separate books, same ownership, and it **consumes the Taylor support system** rather than having its own.

Three rules stated by the Owner (2026-07-31) govern the whole model:

1. **Branded templates.** Every one of the four documents exists in **two branded
   variants** — Taylor and Ventana. Which variant is produced follows the transaction's
   operating company; it is not a user choice at print time.
2. **Sales attribution by origination.** A sale is **Ventana's if it was generated from
   Ventana**. Attribution follows where the sale originated — not who the customer is, and
   not who fulfills it.
3. **Service is an intercompany cost.** Service performed by **Taylor** on **Ventana**
   business is **billed from Taylor to Ventana as a cost** — revenue on Taylor's books,
   cost on Ventana's. See §3.5, Flow 1.
4. **Ice machine equipment is Ventana's.** Ventana **owns the ice machine equipment
   inventory**. When Taylor makes a **retail sale** of an ice machine, **Taylor buys the
   unit from Ventana** — an intercompany purchase running the *opposite* direction from
   service. See §3.5, Flow 2.
5. **All parts are Taylor's, regardless of brand.** The entire parts inventory is owned by
   Taylor — including parts for Ventana-owned ice machine equipment. **Parts carry no
   company-ownership dimension at all.**
6. **Parts are always *sold* by Taylor, from the Taylor parts department.** Not merely
   owned — the parts department is a Taylor function, and parts revenue is Taylor's on
   every transaction, including sales to Ventana's own customers. Extends rule 5 from
   ownership to **sales channel**. See §3.6.
7. **Ventana sells equipment to third parties directly.** Ventana is not only an
   intercompany supplier to Taylor. It sells inventory externally to (a) **third-party
   service companies** and (b) **specially designated customers treated as national
   accounts**. See §3.6.
8. **Company Controllers can override ownership when necessary.** Product-line ownership
   (rule 4) is a **default, not an invariant**. A Controller may reassign it. See §3.7 —
   **the Controller role itself is deferred to the Financials initiative** (Owner
   direction, 2026-07-31); only the override *hook* is designed now.
9. **Accounts declare their line-of-business relationship** — Taylor, Ventana, or both —
   to enable future reporting and salesperson assignment. See §3.8.
10. **Templates must be completable in the field or in the office**, with a paper path for
    use outside the normal process. See §4.0.

Rules 4 and 5 introduce a **second, independent axis**: product-line ownership of
*inventory*, which is not the same thing as sales attribution. Rule 2 (origination) still
governs whose sale it is; rule 4 governs whose stock it was. A Taylor retail sale of an ice
machine is a **Taylor sale** — Ventana's involvement is a supply relationship behind it,
invisible to the customer.

The supplied D2 Sales & Security Agreement already carries a **`National Account Y/N?`**
field (set `Y` for Stingley Management). That field is the existing paper-form ancestor of
this distinction — evidence the business already routes on it manually today.

Note also that every one of the four documents is letterheaded **"Taylor Freezer Sales of
Arizona," 2825 E Chambers St** with its own phone/fax and `Dist. Acct No. 973202`. The
operating company is not just a filter — it is the **legal seller and remit-to identity
printed on the document**. Ventana documents will need their own.

### 3.2 Three candidate models

**Option A — Operating-Company dimension on one shared platform (RECOMMENDED)**

One deployment, one Part Master, one Employee/support organization. Every
customer-or-money-bearing record carries an immutable `operatingCompanyId`
(`TAYLOR` | `VENTANA`) stamped at creation.

```
                     ┌──────────────── Shared Platform ────────────────┐
                     │  Part Master · Employees · Technicians ·        │
                     │  Warehouses · Inventory Ledger · Work Order     │
                     │  engine · Dispatch · Support/Service system     │
                     └───────────────┬────────────────┬───────────────-┘
                                     │                │
              operatingCompanyId=TAYLOR        operatingCompanyId=VENTANA
                                     │                │
                     ┌───────────────▼──┐       ┌─────▼─────────────┐
                     │ Taylor           │       │ Ventana           │
                     │ · Accounts       │       │ · National Accts  │
                     │ · Quotes/Orders  │       │ · Quotes/Orders   │
                     │ · Invoices       │       │ · Invoices        │
                     │ · Doc numbering  │       │ · Doc numbering   │
                     │ · Letterhead/    │       │ · Letterhead/     │
                     │   remit-to       │       │   remit-to        │
                     │ · Tax profile    │       │ · Tax profile     │
                     └──────────────────┘       └───────────────────┘
```

- **Pros:** one support system (the stated requirement); shared parts, techs, and warehouses without duplication; cross-company reporting is possible; matches `BusinessEntityModel.md` §5's already-reserved **Company** entity and the already-reserved `companyId` on Employee (§8a) — this is the model the platform was designed to accept.
- **Cons:** every future query, index, Rules clause, and financial rollup must be company-aware from day one. Retrofitting a tenancy dimension later is far more expensive than adding it now, which argues for deciding this **before** Sales is built, not after.
- **Governance:** activating Company from Future → Core is a **Tier 2** decision under `docs/DelegationCharter.md` and needs its own ADR.

**Option B — Separate deployment/project per company**
Clean legal/financial separation, but it directly contradicts "Ventana utilizes the Taylor
support system": parts, techs, and service history would be duplicated or unreachable
across the boundary. **Not recommended.**

**Option C — A flag on the Account only**
Cheapest, and wrong. Line of business is not a property of the customer — it determines the
*seller*, the document numbering, the letterhead, the tax profile, and which set of books a
transaction lands in. An Account flag cannot separate two companies' revenue. **Not
recommended** as the primary model (a national-account *classification* on the Account is
still useful, but it is a different field with a different job — see §3.4).

**Recommendation: Option A.**

### 3.3 The distinction that must be settled before any build

`National Account`, `Ventana`, and *who did the work* are **three different fields**, and
conflating any two of them is the single highest-risk modeling error here:

- `operatingCompanyId` = *whose books this transaction lands in* — set by the origination rule (§3.1 rule 2), immutable once stamped, drives numbering, letterhead, tax profile, and the branded template variant.
- `performingCompanyId` = *which company actually did the work* — the company whose technicians, parts, and warehouses were consumed. Usually `TAYLOR`. When it differs from `operatingCompanyId`, an intercompany charge is owed (§3.5).
- `salesChannel` = *`RETAIL` or `NATIONAL_ACCOUNT`* — **set on the Sales Order**, flagged by a **National Accounts team**. Owner-confirmed (2026-07-31): **Taylor has its own National Accounts team**, so this classification exists independently inside *both* companies. A Taylor national-account sale is a Taylor sale, not a Ventana one.

Keep them as three fields. Do not derive any one from another. In particular:

- **`performingCompanyId == TAYLOR` on a Ventana job is the normal case, not an anomaly** — it is precisely the condition that generates the intercompany cost (§3.5).
- **`salesChannel == NATIONAL_ACCOUNT` does NOT imply `operatingCompanyId == VENTANA`.** Both companies sell national accounts. This is the trap the model must be built to resist: "national account" is a *how we sell it* classification; "Ventana" is a *whose books it is* fact determined solely by the origination rule (§3.1 rule 2).

All four valid combinations occur in the real business:

| `operatingCompanyId` | `salesChannel` | Real case |
|---|---|---|
| `TAYLOR` | `RETAIL` | Local dealership sale — the D2/D3 Stingley/McDonald's chain |
| `TAYLOR` | `NATIONAL_ACCOUNT` | Taylor's own National Accounts team wins the deal |
| `VENTANA` | `NATIONAL_ACCOUNT` | Ventana's core business |
| `VENTANA` | `RETAIL` | Possible — needs Owner confirmation (§7 Q11) |

Because the flag is set **on the Sales Order**, it is a per-transaction fact, not only an
Account attribute. An Account-level `isNationalAccount` may still be useful as a default
that pre-fills the order, but the **order-level value is authoritative** for pricing,
reporting, and commission. Do not collapse the two into one field on the Account.

### 3.4 What is shared vs. separated (proposed, for review)

| Concern | Shared | Separated by company |
|---|---|---|
| Part Master / SKU catalog | ✅ shared | |
| **Parts inventory & ownership** | ✅ **wholly Taylor-owned, any brand — no owner dimension** | |
| **Equipment inventory ownership** | shared *physical* warehouses | ✅ **owned by product line: ice machines = Ventana, Taylor equipment = Taylor** |
| Physical warehouse locations | ✅ shared | ownership is a separate dimension from location |
| Employees / Technicians / dispatch | ✅ shared | |
| Work Order engine & service history | ✅ shared | tagged with `operatingCompanyId` |
| Equipment / serialized assets | ✅ shared registry | tagged with selling company |
| Accounts / Contacts / Locations | ✅ shared company records | `servicedBy[]` line-of-business tags |
| Quote / Sales Order / Invoice | | ✅ separated, own numbering sequence |
| Document letterhead, remit-to, tax profile | | ✅ separated |
| **Branded document templates** | | ✅ two variants — Taylor and Ventana |
| Financial rollups & reporting | | ✅ separated, with a combined owner view |
| **Intercompany settlement** | | ✅ Taylor ⇄ Ventana, see §3.5 |

### 3.5 Intercompany model — two flows, opposite directions

This is the structurally hardest part of the direction and it has **no precedent anywhere
in the current codebase**. There are **two distinct intercompany flows**, and they run in
opposite directions:

```
                 ┌──────────────┐                    ┌──────────────┐
                 │              │   FLOW 1: SERVICE  │              │
                 │              │ ──────────────────▶│              │
                 │   TAYLOR     │  Taylor performs,  │   VENTANA    │
                 │              │  bills Ventana     │              │
                 │  owns:       │                    │  owns:       │
                 │  · ALL parts │   FLOW 2: EQUIPMENT│  · ice machine│
                 │    (any brand)│◀────────────────── │    equipment │
                 │  · Taylor eqp │  Taylor buys unit  │              │
                 │  · techs/WHs  │  from Ventana on a │              │
                 │              │  Taylor RETAIL sale│              │
                 └──────────────┘                    └──────────────┘
```

**Flow 2 answers a question I had open (Q12): the relationship is bidirectional, not
one-way.** Any design that assumes a single intercompany direction is wrong.

#### Flow 1 — Service: Taylor → Ventana

A Ventana service event is not one transaction. It is two.

```
        VENTANA-originated sale / national account
                        │
                        │  operatingCompanyId = VENTANA
                        ▼
        ┌───────────────────────────────┐
        │  Service work is required     │
        └───────────────┬───────────────┘
                        │  performingCompanyId = TAYLOR
                        │  (Taylor techs, Taylor parts, Taylor warehouse)
                        ▼
    ┌───────────────────────────────────────────────────────┐
    │  ONE Work Order — executed once, in the shared engine  │
    │  fieldops_wos + jobs + parts consumption + time        │
    └───────────────┬───────────────────────┬───────────────┘
                    │                       │
      ┌─────────────▼─────────────┐   ┌─────▼──────────────────────┐
      │ DOC A — INTERCOMPANY      │   │ DOC B — CUSTOMER-FACING    │
      │ Taylor ──bills──▶ Ventana │   │ Ventana ──bills──▶ Customer│
      │                           │   │                            │
      │ Taylor letterhead         │   │ VENTANA-branded template   │
      │ Bill-to: Ventana          │   │ Bill-to: national account  │
      │ Priced at TRANSFER RATE   │   │ Priced at CUSTOMER RATE    │
      │   ⚠ basis undecided (Q9)  │   │                            │
      │                           │   │                            │
      │ Taylor books: REVENUE     │   │ Ventana books: REVENUE     │
      │ Ventana books: COST  ◀────┼───┤ minus the Doc A cost       │
      └───────────────────────────┘   └────────────────────────────┘
                    │                       │
                    └──── must reconcile ───┘
                     same WO, same labor/parts,
                     two prices, two sets of books
```

**What this forces into the design:**

- **One Work Order, two invoices.** The execution record stays single and shared — a second Work Order would fork service history and break the equipment record. The *billing* layer is what doubles.
- **Two price bases on the same consumption.** Transfer price (Taylor→Ventana) and customer price (Ventana→customer) are different numbers over identical labor hours and parts. Pricing (gap G8) can therefore never be a single value on a line item; it must be a **rate context** resolved per billing relationship.
- **A counterparty that is not a customer.** Ventana is a bill-to party on Doc A but is not an external Account. Modeling it as a normal customer Account would silently mix intercompany revenue into external sales figures — a direct violation of the Enterprise Business Metrics Framework's canonical vocabulary rules. It needs to be an internal counterparty, and intercompany revenue needs to be **excluded from, or separately labeled in,** every external sales metric.
- **Elimination on consolidation.** Doc A is revenue to Taylor and cost to Ventana; at the owner/combined level those cancel. Any combined "total sales across both companies" view that simply adds Taylor + Ventana **double-counts** the service work. This must be an explicit, designed behavior, not an afterthought.
- **The customer must never see Doc A.** A Ventana customer receives only the Ventana-branded document, even though a Taylor technician in a Taylor truck performed the work. Document generation must be driven by `operatingCompanyId`, never by who executed.

**Parts are always Taylor's (rule 5), so materials are always part of Flow 1.** A Ventana
job consuming parts is drawing *Taylor-owned* stock, whatever the equipment brand — so the
Taylor→Ventana charge covers **labor and materials**, not labor alone. This resolves the
earlier open question about whether the intercompany layer includes parts: it does,
necessarily, because Ventana owns no parts to draw from.

#### Flow 2 — Equipment: Ventana → Taylor

Ventana owns the ice machine equipment inventory. A **Taylor retail sale** of an ice
machine therefore requires Taylor to acquire the unit from Ventana first.

```
     Taylor retail customer wants an ice machine
                        │
                        │  operatingCompanyId = TAYLOR   (origination rule)
                        │  salesChannel      = RETAIL
                        ▼
     ┌──────────────────────────────────────────────────────┐
     │ The unit in the warehouse is VENTANA-owned inventory  │
     │   physical location : shared Taylor warehouse         │
     │   inventory owner   : VENTANA                         │
     │   ⚠ ownership ≠ location — see below                  │
     └──────────────────────┬───────────────────────────────┘
                            │
          ┌─────────────────▼──────────────────┐
          │ DOC C — INTERCOMPANY PURCHASE      │
          │ Ventana ──sells──▶ Taylor          │
          │   at INTERCOMPANY TRANSFER PRICE   │
          │   ⚠ basis undecided (Q9b)          │
          │ Ventana books: revenue             │
          │ Taylor  books: cost of goods       │
          │ TITLE TRANSFERS: Ventana → Taylor  │
          └─────────────────┬──────────────────┘
                            │
          ┌─────────────────▼──────────────────┐
          │ DOC D — CUSTOMER SALE (T2/T3)      │
          │ Taylor ──sells──▶ retail customer  │
          │   TAYLOR-branded template          │
          │   at customer sell price           │
          │ Customer never sees Ventana.       │
          └────────────────────────────────────┘
```

#### Flow 2 pricing — the three-tier equipment price ladder (Q9b RESOLVED)

Owner direction (2026-07-31): **Ventana has a true cost, a wholesale price to Taylor, and
then a sales price to the customer/account — on all equipment.**

```
Refined by **Q23b (Owner, 2026-07-31): no other groups trade with Ventana — any Ventana
buyer pays a wholesale price similar to Taylor.** Tier 2 is therefore not "the Taylor
price"; it is **Ventana's single outbound price to every buyer**.

```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  TIER 1   TRUE COST to Ventana                                          │
   │           what Ventana actually paid to acquire the unit                │
   │           ▼                                                             │
   │           ├── Ventana margin ──┐                                        │
   │           ▼                    │                                        │
   │  TIER 2   WHOLESALE PRICE  ← VENTANA'S ONLY OUTBOUND PRICE.             │
   │           Charged to EVERY Ventana buyer:                               │
   │              · Taylor (Flow 2, intercompany)                            │
   │              · third-party service companies                            │
   │              · designated national accounts                             │
   │           Ventana revenue / buyer's cost of goods.                      │
   │           ▼                    │                                        │
   │           ├── reseller margin ─┤   (Taylor's, when Taylor resells)      │
   │           ▼                    │                                        │
   │  TIER 3   SALES PRICE to the end customer / Account                     │
   │           TAYLOR'S price, not Ventana's. What appears on T1/T2/T3       │
   │           (D2's "Sell Price", D3's "Unit Price").                       │
   └─────────────────────────────────────────────────────────────────────────┘

        Ventana margin  = wholesale  − true cost
        Taylor  margin  = sales      − wholesale     (only when Taylor resells)
        Combined margin = sales      − true cost     ← what consolidates (G23)
```

**Ventana is structurally a wholesaler/distributor.** It never sells at tier 3. Even a
"specially designated customer considered a national account" buys at wholesale — which is
commercially coherent: a national account large enough to be designated is buying direct at
trade pricing rather than through a dealer.

**This is a genuine simplification, and it removes work:**

- **No buyer-type price selection on the Ventana side.** One outbound tier for every buyer
  means no pricing branch, no tier-resolution logic, no per-class price book on Ventana
  sales. Whatever G30 (account class / buyer type) is eventually for, **it is not a Ventana
  pricing input** — which drops it out of the Phase 2 pricing critical path.
- **Tier 3 belongs to the reseller, not to Ventana.** Sales price is a Taylor concept.
  A Ventana document never shows one.
- **The intercompany transfer price is not special.** Taylor pays the same wholesale price
  as any other trade buyer. Flow 2 is therefore an ordinary wholesale sale that happens to
  be between related companies — the *books* treatment is intercompany, the *pricing* is
  not. That is meaningfully easier to model and easier to defend.
**Q23c resolved (Owner, 2026-07-31): the wholesale price is NOT stored — it is entered at
the time of sale. But sales and their change history must be auditable.**

That is a third answer, and the cheapest of the three: neither a standing price field nor a
per-buyer price book. There is **no price master for wholesale at all**.

```
   ┌──────────────────────────────────────────────────────────────────────┐
   │  NO PRICE MASTER                                                     │
   │    ✗ no wholesale field on the item / model catalog                  │
   │    ✗ no per-customer price list                                      │
   │    ✗ no effective-dated price book, no pricing engine                │
   ├──────────────────────────────────────────────────────────────────────┤
   │  THE TRANSACTION IS THE PRICE RECORD                                 │
   │    ✓ wholesale entered by a human at time of sale                    │
   │    ✓ frozen onto that transaction                                    │
   │    ✓ every change to it recorded — who, when, from → to  (G41)       │
   └──────────────────────────────────────────────────────────────────────┘
```

**This matches an established precedent in this codebase.** `reorder_purchase_orders`
already takes `supplierName` as "manually entered free text — no Supplier/Vendor
Management object, no vendor catalog, no pricing engine exist yet" (BusinessEntityModel
§4b). Manually-entered-with-no-master is a posture this platform has deliberately adopted
before, not an improvisation.

**⚠ The control risk, and why the audit requirement is the right mitigation.** A manually
entered wholesale price with no reference value is the single number that **moves margin
between two companies' books**. Enter it low and margin shifts to Taylor; enter it high and
it shifts to Ventana — with nothing to validate against and no standing price to compare
to. That is precisely why "audit sales and history of changes" belongs in the same sentence
as "entered at time of sale": **the audit trail is the control**, in the absence of a price
master. This should be stated as the explicit rationale in the eventual Specification, not
left as two unrelated requirements.

**What the audit requirement needs (G41):**

- **Append-only change history on the entered prices** — actor, timestamp, previous value,
  new value, and (recommended) a reason when a price is changed after initial entry.
- **This capability does not exist today.** The platform has append-only *records*
  (`inventory_actions`, `fieldops_job_events`, void records) but **no field-level change
  history on any document**. Reorder Request's purchasing-progress fields are explicitly
  *overwritten* with "no history of prior updates is kept." So this is genuinely new.
- **Scope it to prices first, not as a general document audit log.** A universal
  field-change-history capability is a much larger build; a bounded price-change trail
  delivers the control the Owner asked for. Shape it so it can generalize later.
- **Immutable after invoicing — Q23g resolved (Owner, 2026-07-31): once invoiced, prices
  are FROZEN. The only way to change them is to CANCEL the order and create a new one.**
  There is no amendment, no revision, no post-invoice price edit.

```
   BEFORE INVOICE                    AFTER INVOICE
   ─────────────────────────         ─────────────────────────────────────────
   prices editable                   prices FROZEN — no edit path at all
   every change captured in G41         │
   (actor, when, from → to)             ├── need a different price?
                                        ▼
                                     CANCEL the order  ──▶  CREATE A NEW ORDER
                                     (both records kept permanently;
                                      the cancelled one is never deleted
                                      or rewritten)
```

  **This reuses an established platform pattern exactly.** It is the same discipline as
  `docs/specifications/reorder-request-cancellation.md`: terminal states are never reopened,
  a cancellation is recorded rather than erased, and correction means a *new* record rather
  than editing history. Nothing new has to be invented for the lifecycle — only applied to
  Sales Order and Invoice. The existing UI copy precedent applies too: "This action does not
  delete history. The record will remain visible for audit purposes," and the action is
  never labeled "Delete," "Remove," or "Discard."

  Two things this needs that the precedent does not already give: a **`CANCELLED` status on
  the Sales Order/Invoice**, and — recommended — a **link from the replacement order back to
  the cancelled one**, so the audit trail shows why a new order exists. See Q43q.
- **A reference/suggested value is still worth offering at entry** — shown for guidance,
  never enforced. It reduces keying errors without becoming a price master. See Q23e.

#### True cost — a per-unit acquisition fact that varies over time (Q23d, Q9c resolved)

Owner direction (2026-07-31): **cost is cost relative to Ventana, and cost changes over
time — the same item bought from the factory today may cost something different next week.**

This settles Q9c decisively, and in the direction the ladder's structure already implied:

```
   FACTORY ──purchase──▶ VENTANA ──wholesale──▶ buyer ──sales──▶ end customer
              │
              └── TRUE COST is captured HERE, per acquisition, and never changes
                  afterward. It is an ACQUISITION FACT, not a catalog value.

   Unit A  serial N6033712   acquired 06/2026   true cost 14,200
   Unit B  serial N6033988   acquired 07/2026   true cost 14,650   ← same model,
   Unit C  serial N6034102   acquired 07/2026   true cost 14,650      different cost
```

- **True cost is per serialized unit, not per model.** Two identical machines on the same
  shelf can carry different costs. A per-model cost field would be wrong from day one.
- **Cost is immutable once recorded.** It is what was actually paid. It is never updated,
  never revalued, and never re-derived from a current price.
- **Serialization makes the costing method trivial — use SPECIFIC IDENTIFICATION.** Because
  equipment carries serial numbers (D3 and D4 both print them), each unit's margin is
  simply `sale price − that unit's own recorded cost`. This **avoids the FIFO / LIFO /
  weighted-average question entirely** for equipment, which is a significant simplification
  and a direct payoff of the serialized-asset model already under way (ADR-010).
- **Margin must never be computed against a current or average cost.** Historical margin
  reporting uses the cost recorded on that unit at acquisition — otherwise last week's
  reported margin silently changes when this week's purchase price does.
- **Cost travels with the unit.** This reinforces G26 (per-unit inventory records) and binds
  directly to the existing Equipment Custody / Serialized Asset workstream rather than
  creating a parallel costing concept.
- **⚠ Non-serialized items are a different problem.** Parts are fungible — you cannot point
  at which specific washer was sold. If parts cost is ever needed for margin, a costing
  method (FIFO / weighted average) becomes unavoidable. See Q42q. Equipment escapes this
  only *because* it is serialized.

#### Unit allocation recommendation — FIFO vs best cost

Owner direction (2026-07-31): **when sales adds an item to a sales order, recommend which
unit to allocate — first-in-first-out, or best cost.**

**This is an allocation recommendation, not a costing method** — an important distinction
that makes it far cheaper than it sounds. Because equipment is serialized and costed by
specific identification (above), margin always comes from the unit actually sold. Choosing
*which* unit to sell doesn't change how costing works; it changes which real cost applies.
No FIFO/LIFO accounting layer is introduced.

```
   Sales adds "Taylor C602-33" to a Sales Order
                     │
                     ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  AVAILABLE UNITS                          strategy: [ FIFO ▾ ]   │
   │  ┌──────────┬────────────┬──────────┬────────────┬────────────┐  │
   │  │ Serial   │ Acquired   │ Cost     │ Location   │            │  │
   │  ├──────────┼────────────┼──────────┼────────────┼────────────┤  │
   │  │ N6033712 │ 06/2026    │ 14,200   │ WH         │ ★ SUGGESTED│  │
   │  │ N6033988 │ 07/2026    │ 14,650   │ WH         │   select   │  │
   │  │ N6034102 │ 07/2026    │ 14,650   │ WH         │   select   │  │
   │  └──────────┴────────────┴──────────┴────────────┴────────────┘  │
   │  ⓘ Recommendation only — any unit may be selected.               │
   │    A different choice is recorded with the order.                │
   └──────────────────────────────────────────────────────────────────┘

   FIFO       oldest acquisition first — clears aging stock, limits carrying risk
   BEST COST  lowest cost first — maximises margin on THIS deal, but tends to
              leave the expensive units sitting. Worth stating the trade-off in
              the UI rather than presenting "best" as unambiguously better.
```

**Why this fits the platform cleanly:**

- **It matches an established architectural idiom exactly.** This codebase already computes
  recommendations live and never persists them — `domain/dispatchScoring.js`'s
  `computeDispatchRecommendations()`, `technicianRecommendationEngine.ts`,
  `inventoryAnalyticsEngine.ts`, `procurementDraftEngine.ts`. A unit-allocation engine is
  the same shape: a pure function over available units, computed on read, stored nowhere.
  It also matches the platform's stated posture that **AI//the system recommends and humans
  remain accountable**.
- **Non-binding by design.** Sales may pick any available unit. The recommendation is
  guidance, never enforcement — consistent with every other recommendation surface here.
- **A deviation from the recommendation should be recorded**, since choosing a
  higher-cost unit moves margin. It belongs in the same audit trail as price changes (G41).

**Two things it forces that are easy to miss:**

- **⚠ Serial allocation needs a RESERVATION, or two orders will sell the same machine.**
  The moment a specific serial is chosen on an order, it must become unavailable to every
  other order. The platform already has the right precedent for this — `fieldops_inventory`
  splits `quantityAvailable`/`quantityReserved` precisely so "two jobs can't both reserve
  the same physical stock," and `inventoryService.js` enforces it transactionally. For
  serialized units the problem is simpler (a unit is allocated to exactly one order) but it
  is **not optional**. See **G48**.
- **⚠ The recommendation surface exposes cost.** A "best cost" ranking is, by definition, a
  display of cost ordering — and true cost and wholesale are internal-only (G22b). Whoever
  sees this screen sees margin information. That is probably fine for a salesperson and
  clearly wrong for a technician, which makes this a **third** independent driver for G35's
  field-level visibility. A FIFO-only view (dates, no costs) is the natural fallback for
  anyone not cleared for cost. See Q47q.

**A fourth flow is implied here, and Q45q confirms its full scope.** Owner direction
(2026-07-31): **there needs to be a factory PO and a receiving-into-inventory process for
buying from factories or manufacturers.** So this is a real procurement flow, not a minimal
cost-capture shortcut.

```
   FACTORY / MANUFACTURER
        │
        │  ① FACTORY PO            issued to the manufacturer
        ▼
   ┌────────────────────────────────────────────────────────────┐
   │  ② RECEIVING INTO INVENTORY                                │
   │     · serialized equipment → per-unit record + true cost   │
   │       + acquisition date  (G46)                            │
   │     · parts → quantity + cost, feeding weighted-average    │
   │       cost (G50)                                           │
   └────────────────────────────────────────────────────────────┘
        │
        ▼
   stock available for sale / allocation
```

This is **where cost enters the system at all** — for both equipment and parts — so it is a
prerequisite for margin of any kind, not an optional back-office nicety.

**Q56b resolved (Owner, 2026-07-31) — WORKING ASSUMPTION: parts are not bought from the
factory for Ventana.** Reading A. Ventana's factory POs are **equipment only**; Taylor runs
its own factory POs for parts. Rules 5 and 6 hold intact, and the "parts carry no
company-ownership dimension" simplification — recorded above as *worth protecting* — is
protected.

```
   FACTORY ──equipment──▶ VENTANA POs      (true cost per serialized unit)
   FACTORY ──parts──────▶ TAYLOR  POs      (quantity + cost → weighted average)

   One PO process (the reserved `purchase_orders` entity), two purchasing
   companies, cleanly separated by what they buy.
```

**This is flagged "for now," so the design should keep the seam rather than weld it shut.**
Two cheap precautions that cost nothing today and avoid a rewrite if it changes:

- **Put `operatingCompanyId` on the PO itself**, not implied by what is being purchased. If
  Ventana ever buys parts, the PO already carries the right company and nothing has to be
  reshaped.
- **Do not build the parts side in a way that hard-codes "Taylor" as the only possible
  owner.** Parts genuinely need no owner *dimension* today — but "there is exactly one
  owner and it is always Taylor" is a much cheaper thing to widen later than "owner is not
  a concept that exists."

If it ever flips, the consequence is known and documented: reading B adds a third
intercompany transfer (parts, Ventana→Taylor at receipt); reading C reinstates an owner
dimension on parts stock and would ripple into average costing, the service-charge
materials logic, and the parts-always-Taylor validation (G31).

**Q54q resolved (Owner, 2026-07-31): the factory PO IS the reserved `purchase_orders`
entity.** No fourth PO-shaped object is created. The long-reserved Epic 5 Purchase Order
finally gets an execution path, and `reorder_purchase_orders` remains what it has always
been — Taylor's minimal parts-replenishment record, untouched.

```
   purchase_orders           ← THE factory/manufacturer PO. Reserved since Epic 5,
                               Supplier-linked, no write path ever built. NOW BUILT.
   reorder_purchase_orders   ← unchanged. Taylor parts replenishment, 1:1 with a
                               Reorder Request. Not affected by this decision.
```

**Three consequences that follow from choosing the reserved entity:**

- **⚠ Its Rules posture must change.** `purchase_orders` today denies all client writes
  unconditionally (Admin-SDK-only). Giving it a write path is a `firestore.rules` change —
  which is **always a Tier 2 decision** under `docs/DelegationCharter.md`, never routine.
- **⚠ It is Supplier-linked, and Supplier/Vendor Management does not really exist.** The
  platform has a `suppliers` collection and a `supplier_catalog`, but every purchasing
  surface built so far deliberately avoided them — `reorder_purchase_orders.supplierName`
  is manually entered free text precisely because "no Supplier/Vendor Management object, no
  vendor catalog, no pricing engine exist yet." A real factory PO to a manufacturer
  **makes the Supplier entity load-bearing for the first time**. That is additional scope
  this decision pulls in, and it should be sized rather than assumed. See Q58q.
- **It reuses a schema that was designed for line items** (`purchase_orders` relates to Part
  via line items, per BusinessEntityModel §8's relationship diagram), which fits a factory
  PO carrying both equipment and parts lines — a good sign the reserved entity genuinely
  fits rather than merely being available.

#### Cost visibility is COMPANY-SCOPED, not merely role-scoped (Q47q resolved)

Owner direction (2026-07-31): **sales and management roles see cost — but Taylor does not
see Ventana's cost, only their own cost from Ventana.**

This is materially stronger than the role-based rule G22b assumed. It is a **data isolation
boundary between two companies inside one shared platform**.

```
   ┌──────────────────────────┬──────────────────────────────────────────────┐
   │ VENTANA sales/management │ TAYLOR sales/management                      │
   ├──────────────────────────┼──────────────────────────────────────────────┤
   │ ✅ TRUE COST (tier 1)    │ ❌ TRUE COST — never visible                 │
   │ ✅ WHOLESALE (their sale)│ ✅ WHOLESALE — but as THEIR COST, not as     │
   │                          │    Ventana's selling price                   │
   │                          │ ✅ SALES PRICE (tier 3, their sale)          │
   ├──────────────────────────┼──────────────────────────────────────────────┤
   │ margin = wholesale       │ margin = sales − wholesale                   │
   │        − true cost       │                                              │
   └──────────────────────────┴──────────────────────────────────────────────┘

   Neither company sees the other's margin. Each sees only its own two numbers.
```

**Why this is coherent, and why it is harder than it looks:**

- **Commercially it is exactly right.** Wholesale is the boundary: it is Ventana's revenue
  and Taylor's cost, so both may see it. Tier 1 is Ventana's private margin position and
  Taylor has no business seeing it — the same way a dealer doesn't see its distributor's
  buy price.
- **⚠ Role-based UI hiding is NOT sufficient.** The platform's standing rule is that
  `firestore.rules` is the only real authorization boundary and client-side filtering is
  not security. If a Taylor user can read the document that holds `trueCost`, they can read
  the field — regardless of what the UI renders. This therefore needs either a
  **Rules-enforced read boundary** or, more robustly, **true cost stored where Taylor
  cannot read it at all** (a separate document/collection scoped to Ventana).
- **The existing `users/{uid}.role` model cannot express this.** Roles are
  `admin`/`dispatcher`/`technician` — there is no company dimension on identity at all.
  Enforcing company-scoped visibility requires a **company on the user/employee identity**,
  which is new. (Note `employees.companyId` is already *reserved* in
  `BusinessEntityModel.md` §8a as a Future field — this is the concrete requirement that
  activates it.)
- **The allocation screen stays coherent.** A Taylor salesperson ranking units by "best
  cost" ranks by **the wholesale Taylor paid**, not by Ventana's true cost — which is the
  right number for Taylor's own margin anyway. Ventana's own allocation ranks by true cost.
  Same engine, different cost field per viewer's company.
- **Consolidated reporting is the deliberate exception.** The combined owner view
  (G23) spans both — so it must be a distinctly, explicitly authorized surface, not
  something reachable by an ordinary user of either company.
- **✅ Scope bounded — Q55q resolved (Owner, 2026-07-31): the isolation does NOT extend past
  cost, for now.** Taylor users may see Ventana's orders, customers, and other data; only
  *cost* is walled off. **This is a significant de-scoping and it protects Phase 0**: had
  isolation been broader, this would have become a multi-tenant design — categorically
  larger than anything else in this register and a reshaping of the foundation rather than
  a later phase. It stays a **field-level boundary**, which is tractable.
- **"For now" should be designed for, not designed around.** The cheapest way to keep the
  door open is to put company-restricted fields in a place that can be *widened* later
  (e.g. a separate Ventana-scoped document holding cost, rather than a hidden field on a
  shared one). That costs nothing now and avoids a rewrite if the boundary ever grows.

#### Parts margin — the fungible-goods problem, and the standard answer

Owner note (2026-07-31): **parts need margin too, but small items cannot be individually
costed or distinguished from each other.**

That is exactly right, and it is a well-solved problem. Equipment escapes it through
serialization; parts cannot, so parts need a **costing method** rather than
specific identification.

```
   EQUIPMENT                          PARTS
   ─────────────────────────          ─────────────────────────────────────
   serialized → each unit's own       fungible → cannot identify which
   real acquisition cost              specific washer was sold
   SPECIFIC IDENTIFICATION            needs a COSTING METHOD:

                                      ▸ WEIGHTED AVERAGE COST  ← RECOMMENDED
                                        one cost per part, recomputed on each
                                        receipt as a running weighted average.
                                        No layers, no lots, no per-unit tracking.
                                        margin = sale price − current avg cost

                                      ▸ FIFO LAYERS
                                        cost lots with quantities, consumed
                                        oldest-first. More accurate, materially
                                        more machinery (layer records, partial
                                        consumption, layer depletion).
```

**Recommendation: weighted average cost for parts.** It answers the Owner's concern
directly — you never need to distinguish individual small items, because you never track
them individually. One `averageCost` field per part, updated on each receipt:

```
   new average = (existing qty × existing avg + received qty × received cost)
                 ÷ (existing qty + received qty)
```

- It gives real, defensible parts margin without per-unit tracking.
- It requires a **receipt event that carries quantity and cost** — which the factory
  PO/receiving process (G45, now confirmed in scope) provides.
- ⚠ It requires an **authoritative on-hand quantity** to weight against. Today
  `partsCatalog.ts` is static demo data and the real stock authority is the
  `inventory_transactions` ledger, which remains Admin-SDK-only under ADR-003. So parts
  average costing depends on the trusted-write path — the same dependency as Q33's Blaze
  question. It cannot be built on the demo catalog.
- FIFO layers remain available later if the business ever needs lot-level accuracy; the
  average-cost field does not preclude it.

#### Part number supersession — same part, different manufacturer

Owner note (2026-07-31): **a part's number can change if the manufacturer changes for the
same part.**

This is a **cross-reference / supersession** problem, and it is distinct from everything
else in this document:

```
   Part "Door Gasket - HD"
     ├── mfr A part no.  TST-1007      ← used on invoices 2024–2026
     ├── mfr B part no.  XR-88120      ← current
     └── functionally the same part; the same stock; the same demand history
```

**What it forces:**

- **Historical documents must keep the number that was actually used.** An invoice from
  2024 printed `TST-1007` and must continue to show `TST-1007` forever. The supersession
  changes what is *ordered next*, never what was *recorded before* — the same frozen-fact
  discipline as prices and costs.
- **Search and lookup must resolve either number** to the same part, or staff will create
  duplicate part records and split the stock.
- **Stock MERGES into one pool, at weighted average cost — Q52q resolved (Owner,
  2026-07-31).** A manufacturer change does not create a second part. There is one part,
  one on-hand quantity, one reorder point, one demand history, and one average cost.
- **The merge is just another weighted-average computation**, which is a genuinely tidy
  outcome — it reuses G50's formula rather than introducing a separate merge rule:

```
   Part "Door Gasket - HD"
     mfr A  TST-1007   qty 40 @ avg 7.17  ┐
     mfr B  XR-88120   qty 25 @ avg 8.05  ┘ merge
     ───────────────────────────────────────────────────────
     one part · qty 65 · avg cost = (40×7.17 + 25×8.05) / 65
                                  = 7.51
```

  Margin history stays continuous across the manufacturer change, which is what makes the
  merge the right call for reporting as well as for stock.
- **⚠ It also relates directly to the existing INV-CONVERGENCE work**, where `partId == SKU`
  is the established join key. A part whose number changes breaks a SKU-as-identity
  assumption — the durable identity must be an internal part id with manufacturer numbers
  as *attributes*, not the manufacturer number itself. This should be reconciled with that
  workstream rather than decided independently.

#### Depreciating inventory

Owner note (2026-07-31): **there should be a consideration for depreciating inventory.**

Recorded as a requirement; flagged as belonging largely with the deferred Financials work —
but with a **data dependency that must be honored now**.

- **BOTH treatments are required — Q53q resolved (Owner, 2026-07-31).** These are two
  distinct mechanisms, not one feature with a switch, and conflating them would be wrong:

```
   ┌──────────────────────────────────┬──────────────────────────────────────┐
   │ WRITE-DOWN                       │ DEPRECIATION                         │
   │ inventory HELD FOR RESALE        │ demo / rental / company-owned units  │
   ├──────────────────────────────────┼──────────────────────────────────────┤
   │ triggered by aging, obsolescence,│ triggered by TIME, on a schedule     │
   │ or market value falling below    │ from an in-service date              │
   │ cost (net realizable value)      │                                      │
   │ episodic, judgement-based        │ periodic, formulaic                  │
   │ event-driven, may never occur    │ runs every period once in service    │
   └──────────────────────────────────┴──────────────────────────────────────┘
```

  A unit can move between these — a demo machine begins as resale inventory, is placed in
  service (starts depreciating), and may later be sold. **That transition is itself an
  event that must be recorded**, and it means a unit needs a *disposition* (held for
  resale / in service / sold) alongside its cost. See Q57q.
- **The data prerequisite is already satisfied by decisions above.** Per-unit acquisition
  cost and acquisition date (G46) are exactly what any aging, write-down, or depreciation
  calculation needs. Nothing extra has to be captured now — provided those are stored
  per unit, which they are.
- **It gives the FIFO recommendation a business rationale.** "Clears aging stock" stops
  being a preference and becomes a way to avoid write-downs — worth surfacing in the
  allocation UI as *why* FIFO is offered.
- **A carried-value change must never overwrite acquisition cost.** True cost is an
  immutable historical fact; a write-down is a *separate* recorded event against the unit.
  Same append-only discipline as everything else here.

#### National account pricing — a scoped exception to "no price master"

Owner direction (2026-07-31): **there should be the possibility of price lists for larger
national accounts, or a set % discount field for national accounts.**

This is a **deliberate, scoped exception** to Q23c's "no price master." Hand-entry remains
the default for ordinary transactions; a national account may additionally carry a
negotiated pricing agreement. The existing paper forms already anticipate this — **D3's
Sales Order line grid has a `DISC %` column**, which is the paper ancestor of mechanism B.

```
   TWO MECHANISMS — very different costs; do not conflate them
   ┌────────────────────────────────────────────────────────────────────────┐
   │  A. PRICE LIST                        B. SET % DISCOUNT                │
   │  ──────────────────────────           ──────────────────────────       │
   │  agreed price per item, per           one percentage on the account,   │
   │  account                              applied to the base price        │
   │                                                                        │
   │  item × account rows                  ONE FIELD                        │
   │  effective dating / versioning        no maintenance surface           │
   │  assignment + lookup logic            no versioning beyond the audit   │
   │  a maintenance UI to build            trivially cheap                  │
   │                                                                        │
   │  ≈ a subsystem                        ≈ a field + a calculation        │
   └────────────────────────────────────────────────────────────────────────┘
```

**⚠ The dependency that is easy to miss: mechanism B requires a STORED BASE PRICE.**
"10% off" is meaningless without something to take 10% off *of*. Q23c established that
wholesale is **not** stored — so a discount cannot be computed against it. This promotes
**Q9c** (is there a per-model list/sales price?) from a modeling nicety to a **blocking
prerequisite** for national-account discounting:

```
   list price stored per model  ──▶  discount %  ──▶  net price     ✅ coherent
   nothing stored, all hand-entered  ──▶  discount % of WHAT?       ❌ incoherent
```

The pricing model therefore needs **at least one stored, authoritative base price**. The
likely shape is internally consistent: **a per-model list/sales price IS stored** (the
tier-3 base), while **wholesale is not** — tier 3 is a published catalog concept, wholesale
is a negotiated per-deal number.

**Other design points:**

- **Recommend sequencing B before A.** The % discount is one field with immediate value;
  price lists are a subsystem (item×account rows, effective dating, assignment, a
  maintenance UI). Ship B; add A only if the business genuinely negotiates line by line.
- **If both are supported, precedence must be explicit.** An account with a price list *and*
  a discount % needs a stated rule for which wins, or whether they compound. Undefined
  precedence here produces silently wrong invoices. See Q37.
- **Discount overrides must flow into the price audit trail (G41).** A per-line discount
  changed at sale time is exactly the margin-moving edit the audit exists to capture.
- **Which tier does this apply to?** Taylor→customer (tier 3) is the obvious case. But
  Ventana's outbound wholesale was described as "similar to Taylor," and this may be the
  mechanism by which that similarity varies for Ventana's designated national accounts.
  See Q38.
- **Does it apply to PARTS?** National-account parts discounts are extremely common, and
  parts are always a Taylor sale (rule 6). See Q39.
- **`salesChannel = NATIONAL_ACCOUNT` may now stop being classification and become a
  pricing input** — the exact condition Q16 flagged as raising its priority. That condition
  now appears to be met.

**This is cleaner than the "rate context" G22 anticipated.** It is a **named three-tier
price ladder carried on the item**, resolved by *who is buying*, rather than an open-ended
per-relationship rate engine. G22 is revised accordingly — still not "one price per line,"
but a bounded, well-defined ladder rather than an arbitrary matrix.

**What it forces into the design:**

- **Three price fields, not one.** Today `partsCatalog.ts` carries a single `cost` and a
  single `price` — and it is static, non-authoritative demo data besides. Equipment needs
  all three tiers as first-class, authoritative values.
- **Cost is a per-unit fact; price is likely a per-model fact.** *True cost* is what Ventana
  actually paid for **that specific machine** — it varies unit to unit with freight, timing,
  and manufacturer terms. *Sales price* is normally a catalog/list value per model. These
  belong at different levels of the model, and collapsing them onto one record will produce
  wrong margins. See Q9c.
- **The price used must be frozen onto the transaction.** A sale records the actual
  wholesale and sales prices applied at the time, never a live lookup against a catalog that
  may since have changed. Same stored-fact discipline as effective ownership (§3.7).
- **Margin visibility is a permissions question, not just a display one.** True cost and
  wholesale are internal; a technician or a customer-facing document must never surface
  them. This is the same field-level visibility capability G35 already identified for T4 —
  now with a second, independent driver.
- **Consolidation gets a precise definition.** The combined owner view eliminates the
  wholesale leg and reports margin as `sales − true cost`. That is exactly what G23 needs,
  and it confirms that naively summing Taylor + Ventana revenue double-counts.
- **"On all equipment" needs a boundary check.** Taylor-owned equipment has no Ventana leg,
  so it presumably runs a two-tier ladder (cost → sales) rather than three. See Q9d.

**What Flow 2 forces into the design — and it is not the same set as Flow 1:**

- **Inventory ownership is a separate dimension from inventory location.** A single shared
  physical warehouse holds Taylor-owned parts, Taylor-owned equipment, *and* Ventana-owned
  ice machines side by side. The current model (`fieldops_inventory` keyed
  `locationType__locationId__partId`, and `warehouses`/`stock_locations`) has **no owner
  concept at all** — location is the only dimension that exists. Adding an owning-company
  dimension to equipment stock is net-new.
- **Title transfer is an event, not a field.** The moment a Taylor retail sale is made, the
  unit's owner changes Ventana → Taylor. That is a real, auditable inventory event with a
  price attached — structurally similar to the `inventory_transactions` ledger, and subject
  to the same ADR-003 constraint that only a trusted server path may write it.
- **A second transfer price basis.** Flow 1 prices *service*; Flow 2 prices *equipment*.
  They are unlikely to share a formula. G22's rate context must therefore resolve by
  **(billing relationship × what is being priced)**, not by billing relationship alone.
- **Parts are exempt from all of this.** Rule 5 means the parts side of inventory stays
  single-company and needs **no owner dimension** — a genuine simplification worth stating
  explicitly, so nobody adds one "for symmetry." Parts ownership is Taylor, full stop.
- **The mirror case is undefined.** Rule 4 covers Taylor retail-selling a Ventana ice
  machine. It does **not** say what happens when Ventana sells a *Taylor* unit on a
  national account — see Q17.

**Sequencing consequence:** intercompany billing depends on Invoice (G7) and Pricing (G8)
already existing. It cannot be built early, but it **must be designed before** Pricing is
built — a pricing model that assumes one price per line cannot later be retrofitted to
carry a service transfer price, an equipment transfer price, and a customer price over the
same catalog item.

### 3.6 Ventana's external sales — and why parts never follow

Ventana is **not only an intercompany supplier to Taylor**. It sells equipment externally,
to two distinct buyer types (rule 7). Meanwhile parts **never** leave Taylor's hands
(rules 5 + 6). The result is that a single third-party buyer is a customer of *both*
companies at once, for different things:

```
                        ┌──────────────────────────────┐
                        │   VENTANA  — sells EQUIPMENT │
                        └───┬──────────┬───────────┬───┘
                            │          │           │
              intercompany  │          │ external  │ external
                            ▼          ▼           ▼
                    ┌───────────┐ ┌──────────┐ ┌──────────────────┐
                    │  TAYLOR   │ │ 3rd-party│ │ Designated       │
                    │ (Flow 2,  │ │ SERVICE  │ │ customers treated│
                    │ for its   │ │ COMPANIES│ │ as NATIONAL      │
                    │ retail    │ │          │ │ ACCOUNTS         │
                    │ sale)     │ │          │ │                  │
                    └───────────┘ └────┬─────┘ └────────┬─────────┘
                                       │                │
                        ┌──────────────┴────────────────┘
                        │  ...and the SAME buyer buys PARTS from:
                        ▼
                ┌────────────────────────────────────────┐
                │  TAYLOR PARTS DEPARTMENT               │
                │  every part, every brand, every buyer  │
                │  — always a TAYLOR sale (rules 5 + 6)  │
                └────────────────────────────────────────┘
```

**What this forces into the design:**

- **Every Ventana buyer pays WHOLESALE** (Q23b, §3.5's ladder). Taylor, third-party service
  companies, and designated national accounts are all trade buyers at the same tier.
  Ventana never sells at retail price.
- **A buyer type dimension, distinct from sales channel — but NOT a pricing input.** A
  third-party *service company* is a reseller/trade buyer, not an end user. That is a
  different concept from `salesChannel` (`RETAIL` | `NATIONAL_ACCOUNT`) and from
  `relationshipTypes` (`CUSTOMER`/`VENDOR`, already specified on `accounts`). Likely a
  separate `accountClass` — do **not** overload `salesChannel` with it. Since Ventana
  prices every buyer identically, this dimension exists for **reporting and classification
  only**, not to select a price.
- **"Specially designated customers considered national accounts" is an explicit
  designation, not a derived property.** Something or someone marks an account as such.
  That is a governed classification with an authority behind it (see Q22) — not a filter
  on size or site count.
- **One Account, two selling companies.** The same third-party service company appears as a
  Ventana equipment customer *and* a Taylor parts customer. This confirms the §3.4
  decision to keep `accounts` shared and tag transactions rather than duplicating company
  records — but it also means **an Account's revenue is never single-company**, and any
  "customer sales" figure must state which company's books it is drawn from.
- **Parts never route through Ventana.** Even when the buyer is Ventana's own equipment
  customer, a parts sale is a Taylor transaction with `operatingCompanyId = TAYLOR`. This
  is a hard rule worth encoding as a validation, not a convention — it is exactly the kind
  of thing that erodes silently once someone builds "sell everything on one order."
- **Mixed-company orders are therefore a real risk.** A buyer wanting a machine *and*
  parts on one document is asking for something that spans two companies' books. Whether
  the platform permits a single mixed order (split at invoicing) or requires two separate
  orders is an unresolved design decision — see Q21.
- **Third-party service companies likely service their own equipment**, which means Flow 1
  (Taylor→Ventana service) does **not** apply to them. Confirm in Q23.

### 3.7 Controller ownership override

Rule 8 changes the ownership model's nature: product-line ownership (G25) is a **computed
default that can be deliberately overridden**, not a derived invariant. That has real
consequences.

```
   OWNERSHIP RESOLUTION — three layers, in order
   ┌──────────────────────────────────────────────────────────────┐
   │ 1. DEFAULT   derived from product line                       │
   │              ice machines → VENTANA · Taylor equip → TAYLOR  │
   │              (G25, from the equipment model catalog)         │
   ├──────────────────────────────────────────────────────────────┤
   │ 2. OVERRIDE  a Company Controller reassigns ownership        │
   │              requires: authority · reason · timestamp · actor│
   │              append-only, never edited, never deleted        │
   ├──────────────────────────────────────────────────────────────┤
   │ 3. EFFECTIVE the value the system actually uses              │
   │              = override if present, else default             │
   │              never recomputed from the catalog once overridden│
   └──────────────────────────────────────────────────────────────┘
```

> **DEFERRED — Owner direction, 2026-07-31.** The **Company Controller role is not designed
> or built in this initiative**; it is taken up when the **Financials section** is scoped.
> What remains in scope here is only the *shape* the override must eventually take, so that
> ownership is modeled from the start as an overridable default with an audit seat — rather
> than as a derived invariant that would have to be torn out later. **Questions Q24–Q27
> below are deferred with it and are not blocking.** The practical near-term instruction:
> store effective ownership as a real field with a default, never as a value recomputed
> from the catalog on read.

**Why this will be a high-governance action when it is taken up, not a form field:**

- **An ownership override moves money between two companies' books.** It changes which
  company holds the asset, which company's cost of goods a sale draws on, and which
  company's revenue the transaction produces. It is materially financial.
- **It needs a real authority.** "Company Controller" is a **new role that does not exist**
  in `ROLES` (`admin`/`dispatcher`/`technician`) or in `OPERATIONAL_ROLE`. Whether it is a
  security role, an operational role, or per-company (a Taylor Controller and a Ventana
  Controller, each able to act only for their own company) is unresolved — see Q24. Note
  the platform's standing rule that `firestore.rules` enforces authorization solely via
  `users/{uid}.role`; an operational role alone cannot gate this.
- **It must be append-only and permanent.** Per the platform's no-delete rule and the
  Cancel/Void precedent (`docs/specifications/reorder-request-cancellation.md`), an
  override is recorded as a new immutable fact with a required non-blank reason —
  never an in-place edit of the ownership field with no history. Reversing an override
  means recording another one.
- **Effective ownership must never silently re-derive.** Once overridden, a later change to
  the product-line catalog must not quietly reclaim the unit. This is the same
  "stored fact vs. computed value" discipline `reviewDecision` already follows against
  `status` on Reorder Request.
- **Granularity is undecided and matters a great deal** — see Q25. Overriding a whole
  product line, an individual serialized unit, and a single transaction are three very
  different capabilities with different blast radii.

### 3.8 Account line-of-business relationship — the cheapest item in this document

Rule 9: an Account declares whether it has a **Taylor relationship, a Ventana relationship,
or both**, to support future reporting and salesperson assignment.

**This maps exactly onto a pattern the codebase already has.** `accounts` is already
specified to carry `relationshipTypes: ("CUSTOMER" | "VENDOR")[]` — an optional, additive,
multi-valued classification that is informational only, gates no authorization, and
required **no Firestore Rules change** because the `accounts` match block has no
field-level validation (`docs/specifications/customer-account-business-model.md` §1,
`domain/constants.js`'s `ACCOUNT_RELATIONSHIP_TYPE`). A line-of-business relationship is
the same shape with a different value set:

```
   accounts/{accountId}
     ├── relationshipTypes[]         ["CUSTOMER"] | ["VENDOR"] | both   [S] specified
     └── lineOfBusiness[]            ["TAYLOR"]   | ["VENTANA"] | both  [N] proposed
                                      ▲
                                      └── same array shape, same additive posture,
                                          same "no badge when unset" rule,
                                          same no-Rules-change property
```

Design points, carried straight over from the existing precedent:

- **Optional and additive.** Absent on every existing Account until edited. No migration, no backfill.
- **Renders as badges in Account Summary**, alongside the CUSTOMER/VENDOR badges. An Account with no value renders **no badge** — never a silent default to "Taylor."
- **Informational, not authorizing.** It must not gate page sections or permissions, exactly as `relationshipTypes` must not. Authorization stays on `users/{uid}.role`.
- **It is a fourth distinct concept** — keep it separate from `operatingCompanyId` (whose books a *transaction* lands in), `salesChannel` (retail vs national account, per order), and `accountClass` (buyer type, §3.6). An Account having a Ventana relationship does **not** determine any individual transaction's operating company; the origination rule (rule 2) still does.
- **Confirms §3.6's finding.** "Both" is a first-class, expected value — it is precisely the third-party service company that buys equipment from Ventana and parts from Taylor.

**Salesperson assignment** is the stated downstream purpose, and the Owner has clarified
its shape (2026-07-31): **a salesperson is typically assigned to one company or the
other** — but **Q28b resolved: not normally, though assume a rep CAN carry both.** The
field is therefore multi-valued and the eligibility check is a **warning, not a block**.

```
   Employee (G19)
     └── salesCompanies[] : ("TAYLOR" | "VENTANA")[]
                            ← usually one value; both is permitted and must not error

   Account with lineOfBusiness = ["TAYLOR", "VENTANA"]
     ├── Taylor  rep ──▶ an Employee whose salesCompanies[] includes TAYLOR
     └── Ventana rep ──▶ an Employee whose salesCompanies[] includes VENTANA
                          usually two different people; the same person is legal
```

Design consequences:

- **The company affiliation belongs on the Employee, not on the assignment.** The
  Account→rep assignment does not restate the company — it is implied by whom you picked.
- **Assignment eligibility is a SOFT check.** Because both-company reps are permitted,
  picking a rep whose `salesCompanies[]` omits that line of business should **warn, not
  block**. A hard block would make the exception case unworkable, and it matches this
  platform's standing posture that classifications of this kind are informational and never
  authorizing.
- **The Account still needs an assignment *per line of business*, not one `salespersonId`.**
  An Account with both relationships has two rep slots — even when the same person fills
  both. This confirms G33's shape and rules out the simpler single-field design.
- **This is now the third use of one array idiom.** `relationshipTypes[]` (CUSTOMER/VENDOR,
  already specified), `lineOfBusiness[]` (TAYLOR/VENTANA, G32), and `salesCompanies[]`
  (TAYLOR/VENTANA, G33) are all optional, additive, multi-valued, informational-only, and
  need no Rules change. Build them to one consistent shape rather than three near-identical
  one-offs.

**Recommended sequencing note:** this is the single lowest-cost, lowest-risk item in the
entire register — an optional array field with an established precedent, no Rules change,
no migration, and immediate reporting value. It is a reasonable **first** deliverable of
the whole initiative, independent of everything else, and it starts capturing the data that
later reporting will need.

---

## 4. Template wireframes

### 4.0 Access modality — field, office, and paper

Rule 10: every template must be **completable in the field or in the office**, with a
**paper path** for use outside the normal process. Three modalities, one field set:

```
   ┌──────────────┐   ┌──────────────┐   ┌───────────────────────────┐
   │  FIELD       │   │  OFFICE      │   │  PAPER (outside process)  │
   │  mobile/     │   │  desktop     │   │  blank printable form     │
   │  tablet      │   │  full screen │   │  → filled by hand         │
   │              │   │              │   │  → re-entered later       │
   │  technician  │   │  dispatcher/ │   │  → OR attached as a       │
   │  on site     │   │  sales/admin │   │    scanned artifact       │
   └──────┬───────┘   └──────┬───────┘   └─────────────┬─────────────┘
          └──────────────────┴──────────────────────────┘
                     ONE template definition
              same fields · same validation · same record
```

**What this requires, and the tensions it creates:**

- **One template definition, three renderings.** The field set must be defined once and
  rendered responsively, not forked into a "mobile version" that drifts from the office
  version. This repo already has a mobile surface (`modules/mobile/`, Field Mode in NAV,
  `docs/MobileStrategy.md`) to build on rather than invent.
- **⚠ A real access-model tension the current roles cannot express.** T4 (Service Invoice)
  must be completable **in the field by a technician** — yet it carries pricing, labor
  rates, tax, and grand totals. Today `ROLE_NAV_ACCESS` gives `technician` only
  `fieldMode`/`jobs`/`technicianDashboard`, deliberately excluding `inventory` and
  `operations` because a technician "has no reason to see ledger/warehouse/procurement
  reporting." The same reasoning applies to margin and pricing. **This needs field-level
  visibility within a single document, not just route-level access** — a technician
  completes the work performed, parts used, times, and readings; the office completes or
  reveals the money. That is a capability the platform does not have today and it should be
  designed deliberately, not solved by widening the technician's route access. See Q29.
- **Offline behavior is an open question, not an assumption.** "In the field" often means
  poor connectivity in a walk-in cooler or a back-of-house mechanical room. Whether these
  forms must capture offline and sync later is a substantial architectural decision that
  affects every write path in the initiative — see Q30. This document does **not** assume it.
- **The paper path is two different things.** A *blank printable form* (for capture where
  no device is usable) and *re-entry or attachment afterward* are separate capabilities.
  Blank-form printing is cheap; a scanned-artifact attachment path implies file storage,
  which the platform does not currently use. See Q31.
- **Print parity resurfaces here.** A blank printable form is only useful if it matches the
  paper form staff already know, which makes the earlier Q8 (print parity) load-bearing
  rather than optional for at least the blank-form case.
- **Signature capture (G17) is modality-dependent** — see §4.0a, which the Owner has now
  specified in full.

### 4.0a Signature capture — a three-rung ladder

Owner direction (2026-07-31), in preference order. **Ideal is an on-device electronic
signature; print-and-photograph is the working fallback.** Applies to both **delivery**
(T3) and **service** (T4).

```
   RUNG 1 — IDEAL          ┌────────────────────────────────────────┐
   e-signature on phone    │  Client signs with finger/stylus on the │
   "signature aperture"    │  technician's phone, on site.          │
                           │  Captured directly into the record.    │
                           └────────────────────────────────────────┘
                                            │ when not workable
                                            ▼
   RUNG 2 — FALLBACK       ┌────────────────────────────────────────┐
   print → wet sign →      │  Print the completed form in the field,│
   photograph into app     │  client signs on paper, technician     │
                           │  photographs it into the app.          │
                           └────────────────────────────────────────┘
                                            │ when no device at all
                                            ▼
   RUNG 3 — OUTSIDE        ┌────────────────────────────────────────┐
   PROCESS                 │  Blank printable form, filled entirely │
                           │  by hand, re-keyed and/or attached     │
                           │  afterward. (G36/G37, rule 10)         │
                           └────────────────────────────────────────┘
```

**This resolves Q31: the answer is both (a) and (b)** — a printable form *and* a captured
image filed against the record — with photo capture rather than a desk scanner. It also
sharpens rung 2: what is printed in the field is the **completed** form, not a blank one.

**What the ladder forces into the design:**

- **⚠ Rungs 1 and 2 both require file/blob storage, which this platform does not use
  today.** A signature bitmap and a photograph are binary objects. Nothing in the current
  architecture stores files — there is no Firebase Storage usage, no `storage.rules`, and
  no upload path anywhere in the codebase. This is a **net-new infrastructure dependency**
  with its own security-rules surface, separate from `firestore.rules`. It is the largest
  hidden cost in rule 10. See **G38** and **Q33**.
- **A signature must be bound to *what was signed*.** A signature image stored loose
  against a record is close to worthless in a dispute, because the record can change
  afterward. The signature needs to capture, at minimum: signer name, signer title,
  timestamp, capture method (rung 1/2/3), the acting technician, and **an immutable
  rendering or content hash of the document as it stood at signing**. This is the same
  append-only, never-edited discipline the platform already applies to void and
  cancellation records. See **G39**.
- **Capture method must be recorded, not inferred.** "Signed electronically on device" and
  "photograph of a wet signature" carry different evidentiary weight, and the business will
  eventually need to tell them apart. Store the rung.
- **Signature is terminal and immutable.** Once signed, the signed content must not be
  editable. If something is wrong, the correction is a new document — consistent with the
  platform's permanent no-delete rule and the Cancel/Void precedent.
- **Printing in the field is a real requirement, not a nice-to-have.** Rung 2 depends on
  it, which means field printing (or a print-to-PDF-and-share path) is in scope for T4 and
  T3 specifically. This makes Q8 (print parity) load-bearing for the *completed* form too,
  not only the blank one.
- **Delivery and service are both signature events.** T3 (Pick Ticket / delivery) and T4
  (Service Invoice) both need the ladder. T2's customer signature (D2's "Buyer" signature
  on the Sales & Security Agreement) is a *sales* signature with different context — see
  Q34, now sharpened by the scope boundary below.

**Scope boundary — Q36 resolved (Owner, 2026-07-31): signature capture is IN-FIELD,
IN-PERSON ONLY. There is no send-for-signature capability.**

```
   IN SCOPE                              EXPLICITLY OUT OF SCOPE
   ─────────────────────────────────     ──────────────────────────────────────
   ✅ client signs on the technician's    ❌ emailing a signature request
      device, on site, in person         ❌ a remote-approver signing flow
   ✅ wet signature on a printed form,    ❌ signature-request status tracking
      photographed on site                  (sent / viewed / signed / expired)
   ✅ blank paper, filled by hand         ❌ third-party e-sign service integration
                                         ❌ reminder / expiry / resend logic
```

This is a **meaningful scope reduction**, and worth recording as a decision rather than an
omission. A send-for-signature flow is effectively its own subsystem — request records,
delivery, status lifecycle, expiry, reminders, an external recipient identity with no
platform account, and usually a third-party integration. Ruling it out keeps the signature
work to *capture* rather than *orchestration*, and keeps G38 (file storage) as the only new
infrastructure the ladder introduces.

**Consequence for T2 (Q34):** if there is no send-for-signature path anywhere, then the
Sales & Security Agreement is signed either **in person by the salesperson** (the same
ladder, different actor and setting) or **on paper, outside the system**. It cannot be
"emailed for signature," because that capability will not exist. Q34 narrows to: which of
those two is it?

**Verification needed before costing this:** the governance docs in this repo state that
trusted server-side work is blocked on Firebase Blaze not being enabled
(`BusinessEntityModel.md` §4a), while the more recent Auth Modernization workstream records
Blaze as already live with functions deployed. **These disagree, and the discrepancy is
directly relevant** — Storage availability and the trusted-write path for images both
depend on it. Resolve against the live project before sizing G38. See Q33.

ASCII wireframes below are **structure and field-coverage proposals**, not visual design.
Field Ops design-system styling, spacing, and component decomposition are deliberately
out of scope at this gate.

Legend used in every wireframe and table:
- `[E]` **Exists** — a real, built field/collection today
- `[S]` **Specified, unbuilt** — approved or drafted in a governance doc, no code
- `[N]` **New** — no home anywhere; would be net-new modeling

**Every template below exists in two branded variants** (§3.1 rule 1) — Taylor and Ventana.
The variant is **selected by `operatingCompanyId`, never chosen at print time**, and it
drives letterhead, logo, legal seller name, remit-to address, phone/fax, boilerplate terms,
compliance footers, and the document-number prefix. The *field set is identical* across
variants; only the company document profile differs. The wireframes are drawn in the Taylor
variant for readability.

```
   ┌──────────────────────────────┐        ┌──────────────────────────────┐
   │ ▲▲▲ TAYLOR  A R I Z O N A    │        │ ▲▲▲ VENTANA                  │
   │ Taylor Freezer Sales of AZ   │        │ <Ventana legal name>    [Q4] │
   │ 2825 E Chambers St           │        │ <Ventana remit-to>      [Q4] │
   │ Phoenix AZ 85040-3736        │        │                              │
   │ Ph 602-276-1733              │        │                              │
   │ Doc no. Q-/SO-/I-/WO-        │        │ Doc no. own sequence    [Q4] │
   └──────────────────────────────┘        └──────────────────────────────┘
     operatingCompanyId = TAYLOR              operatingCompanyId = VENTANA
                        └──── same fields, same screens ────┘
```

---

### 4.1 Template T1 — Sales Quote / Sales & Security Agreement (from D2)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [ TAYLOR ▾ ]  ← operating company selector [N]      Quote  Q-2026-00412 [N]  │
│ Taylor Freezer Sales of Arizona · 2825 E Chambers St · Phoenix AZ 85040 [N]  │
│                                        Status: ● DRAFT  Sent  Signed  Lost   │
├──────────────────────────────────────────────────────────────────────────────┤
│ BUYER                                                                        │
│  Customer Account #  [ MC075          ] [E] accounts.customerNumber          │
│  Operating Name      [ Stingley Management        ] [E] accounts.name        │
│  Billing Address     [ 28706 N 56th St            ] [E] accounts.billing…    │
│  City [Cave Creek] State [AZ] Postal [85331]        [E] structured address   │
│  National Account?   ( )Y (•)N   [N]  ← see §3.3, distinct from company      │
│  Customer PO #       [                ] [N]                                  │
│  Lease?              ( )Y (•)N        [N]                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ INSTALL / SHIP-TO                                                            │
│  Location Name       [ TBD            ] [E] locations                        │
│  Install Address / City / State / Postal          [E] locations + address    │
│  Contact Name  [ Ed Okeefe ]  Phone [ 602-423-9656 ]  [E] contacts           │
│  Email         [ eokeefe@stingleymcd.com          ]   [E] contacts           │
│  Site Contact  [ Ed Okeefe ]  Phone [ 602-423-9656 ]  [E] contacts           │
├──────────────────────────────────────────────────────────────────────────────┤
│ FULFILLMENT                                                                  │
│  Shipping Instructions [ N/A ] [N]   Ship Via [ N ] [N]                      │
│  Deliver / Install / Both  ( )D ( )I (•)B  [N]                               │
│  Salesperson  [ Santana Gonzalez ▾ ]  [S] employees + SALES_ASSOCIATE role   │
├──────────────────────────────────────────────────────────────────────────────┤
│ PURCHASE INFORMATION                            [ + Add Line ]               │
│ ┌────┬─────┬───────────────┬───────────┬──────────────┬────────┬──────────┐ │
│ │QTY │ Mfg │ Model #       │ Condition │ Est. Arrival │ Sell $ │ Warranty │ │
│ ├────┼─────┼───────────────┼───────────┼──────────────┼────────┼──────────┤ │
│ │ 1  │ TA  │ C60233BANU    │ New ▾     │              │21,698  │ Factory  │ │
│ │    │     │ Soft Serve/Shake Combo Taylor Unit                           │ │
│ └────┴─────┴───────────────┴───────────┴──────────────┴────────┴──────────┘ │
│   Model # → [N] equipment model catalog (partsCatalog is service parts only) │
│   Condition (New/Used/Demo/Refurb) [N] · Warranty terms [N] · Sell price [N] │
├──────────────────────────────────────────────────────────────────────────────┤
│ TERMS                                    Sub-Total          $21,698.00  [N]  │
│  ☐ ______________                        Shipping Charge    $      —    [N]  │
│  ☐ ______________                        Install Charge     $      —    [N]  │
│  ☐ ______________                        State Tax  9.1%    $ 1,974.52  [N]  │
│                                          ───────────────────────────────     │
│                                          Total Purchase     $23,672.52  [N]  │
│                                          Down Payment       $      —    [N]  │
│                                          Value of Trade-In  $      —    [N]  │
│                                          Balance            $23,672.52  [N]  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Special Instructions [                                              ] [N]    │
│ Remove existing equipment? ( )Y (•)N  [N]                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Seller signature ______________ Dated ______   Buyer signature ______ Dated  │
│                                        [N] e-signature capture + audit fact  │
├──────────────────────────────────────────────────────────────────────────────┤
│           [ Save Draft ]  [ Send to Customer ]  [ Convert to Sales Order → ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Field mapping — T1**

| Printed field | Proposed system field | Owning entity | Status |
|---|---|---|---|
| Customer Account # | `customerNumber` | `accounts` | [E] |
| Operating Name | `name` | `accounts` | [E] |
| Billing Address / City / State / Postal | `billingAddress.{street,city,state,zip}` | `accounts` | [E] |
| National Account Y/N | `isNationalAccount` | `accounts` | [N] |
| Customer PO # | `customerPoNumber` | Quote | [N] |
| Lease Y/N | `isLease` | Quote | [N] |
| Install Location Name / Address | Location record | `locations` | [E] |
| Contact Name / Phone / Email | Contact record | `contacts` | [E] |
| Site Contact Name / Phone | `siteContactId` | Quote → `contacts` | [E] entity, [N] role-on-quote |
| Shipping Instructions / Ship Via | `shippingInstructions`, `shipVia` | Quote | [N] |
| Deliver / Install / Both | `fulfillmentType` | Quote | [N] |
| Salesman Name | `salespersonEmployeeId` | Quote → `employees` | [S] |
| QTY / Mfg / Model # / Description | Quote line item | Quote Line | [N] |
| Condition (New/Used/…) | `condition` | Quote Line | [N] |
| Est. Arrival | `estimatedArrivalDate` | Quote Line | [N] |
| Sell Price / Total $ | `unitSellPrice`, `extendedPrice` | Quote Line | [N] |
| Warranty | `warrantyTermId` | Quote Line → Warranty Term | [N] |
| Sub-Total / Shipping / Install / Tax / Total | Quote totals block | Quote | [N] |
| State Tax 9.1% | `taxRate`, `taxAmount`, `taxJurisdiction` | Quote | [N] |
| Down Payment / Trade-In / Balance | `downPayment`, `tradeInValue`, `balanceDue` | Quote | [N] |
| Special Instructions | `specialInstructions` | Quote | [N] |
| Remove (Y/N) | `removeExistingEquipment` | Quote | [N] |
| Buyer / Seller signature + date | Signature audit record | [N] | [N] |
| Operating company + letterhead | `operatingCompanyId` | Quote | [N] |
| Quote number | `quoteNumber` (per-company sequence) | Quote | [N] |

---

### 4.2 Template T2 — Sales Order (from D3, order view)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TAYLOR ARIZONA                     Sales Order  239164 [N]                   │
│                          Status: ● OPEN  Picking  Shipped  Invoiced  Closed  │
│                          Origin: Quote Q-2026-00412 → [ view ] [N]           │
├─────────────────────────────────────┬────────────────────────────────────────┤
│ SOLD TO                             │ SHIP TO                                │
│ Stingley Management          [E]    │ McDonald's #35362               [E]    │
│ Nina Zaya                    [E]    │ Joe G.C.                        [E]    │
│ 28706 N. 56th St.            [E]    │ 3400 E. Sky Harbor Blvd.        [E]    │
│ Cave Creek, AZ 85331         [E]    │ Terminal 4, Space N4            [E]    │
│ United States                [N]*   │ Phoenix, AZ 85034               [E]    │
├─────────────────────────────────────┴────────────────────────────────────────┤
│ Account No. [ MC075 ][E]  Salesperson [ SG ][S]  Terms [ Net 30 ][N]         │
│ Customer PO No. [ MCDONALD'S #35362 ][N]  Internal Order No. [ … ][N]        │
│ Ship Via [        ][N]   Date Shipped [ 07/24/26 ][N]                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ SALES CLASSIFICATION      ← set by the National Accounts team          [N]   │
│   Sales Channel   (•) Retail        ( ) National Account   [N] salesChannel  │
│   Operating Co.   [ TAYLOR ]  immutable, from origination  [N]               │
│   Performing Co.  [ TAYLOR ]  who executes; ≠ Operating Co ⇒ intercompany    │
│                                                            [N] see §3.5      │
│   ⚠ Retail vs National Account is INDEPENDENT of Taylor vs Ventana — both    │
│     companies run a National Accounts team. See §3.3.                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ LINES                                                                        │
│ ┌────┬────┬───┬────────────┬───────────────────┬──────────┬──────┬─────────┐│
│ │Ord │Shp │BO │ Item No.   │ Description       │Unit Price│Disc %│Extended ││
│ ├────┼────┼───┼────────────┼───────────────────┼──────────┼──────┼─────────┤│
│ │ 1  │ 1  │ 0 │C60233BANU  │Taylor Model C602-33│21,698.00│  —   │21,698.00││
│ │    │    │   │ Serial #s: N6033712  [N] serialized asset link              ││
│ │    │    │   │ Warranty: 5yr compressor/hopper; 2yr beater motor & gear    ││
│ │    │    │   │           drive; 1yr electronic parts; 2yr service     [N]  ││
│ └────┴────┴───┴────────────┴───────────────────┴──────────┴──────┴─────────┘│
│  Ordered / Shipped / Backordered quantities → [N] order fulfillment state    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                    SALES AMOUNT           21,698.00  [N]     │
│                                    SALES TAX               1,974.52  [N]     │
│                                    TOTAL                  23,672.52  [N]     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Standard terms text (title retained until paid, no return on electrical      │
│ parts, 3% surcharge >$500 card) — company-scoped boilerplate  [N]            │
├──────────────────────────────────────────────────────────────────────────────┤
│   [ Generate Pick Ticket → ]   [ Invoice → ]   [ Cancel Order ]              │
└──────────────────────────────────────────────────────────────────────────────┘
```
\* `country` is not part of the current structured address (US-only this iteration, per
`docs/specifications/customer-record-page-structured-address.md`), yet it prints on D3/D4.

**New concepts introduced by T2:** order lifecycle status; ordered/shipped/backordered
quantity triple; per-line serial assignment; payment terms; discount %; warranty text bound
to a line; company-scoped boilerplate terms; a per-company order-number sequence.

**Sold-To vs Ship-To is a real modeling requirement here:** `Stingley Management` (the
Account) is billed, `McDonald's #35362` (a Location, with its own `MC075-35362` customer
number on D4) is shipped to. The current `accounts` → `locations` relationship supports
this shape, but nothing today carries a *transaction* that points at both.

---

### 4.3 Template T3 — Pick Ticket (from D4)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TAYLOR ARIZONA           Picking List by Order                               │
│ Location: WH [E] warehouses      Order 239164 [N]   Order Date 07/24/2026    │
├─────────────────────────────────────┬────────────────────────────────────────┤
│ SOLD TO  (from order)         [E]   │ SHIP TO  (from order)            [E]   │
├─────────────────────────────────────┴────────────────────────────────────────┤
│ Customer No. [ MC075-35362 ][N]*  Ship Via [   ][N]  Shipment Date [7/24/26] │
│ P.O. No. [ MCDONALD'S #35362 ][N] Terms [Net 30][N] Salesperson [S. Gonzalez]│
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────┬───────────┬─────────┬──────┬───────┬───────┬────────┬─────────┐│
│ │Shelf/Bin │ Item No.  │ Item SN │ UoM  │ Qty   │ Qty   │ Back   │ Picked  ││
│ │ No.      │           │ Location│      │Ordered│Shipped│ Order  │  ☐      ││
│ ├──────────┼───────────┼─────────┼──────┼───────┼───────┼────────┼─────────┤│
│ │  [N]     │C60233BANU │  [N]    │Each  │   1   │   0   │   1    │  ____   ││
│ │          │Taylor Model C602-33   [E] unit/UoM exists on partsCatalog      ││
│ │  Serial No. N6033712  [N] serialized asset                                ││
│ └──────────┴───────────┴─────────┴──────┴───────┴───────┴────────┴─────────┘│
├──────────────────────────────────────────────────────────────────────────────┤
│   [ Print ]   [ Confirm Pick → posts to inventory_transactions ]  ⚠ see note │
└──────────────────────────────────────────────────────────────────────────────┘
```
\* Note the *location-level* customer number `MC075-35362` on D4 vs the account-level
`MC075` on D3 — the business already numbers sites, not just accounts. Location today has
no `customerNumber` field.

**⚠ Governance note on "Confirm Pick":** posting a pick to real stock means writing
`inventory_transactions`, which is **Admin-SDK-only** by ADR-003 and remains blocked on
Firebase Blaze (`BusinessEntityModel.md` §4a Backlog note, issue #15). Any pick-confirm
action either (a) waits for the trusted Cloud-Function write path, or (b) logs to
`inventory_actions` as an audit note that explicitly does **not** move stock — the exact
posture Sprint 2.1.9 already adopted. It must not quietly invent a second stock authority.

**New concepts introduced by T3:** shelf/bin location; serial-number location; per-line pick
confirmation; backorder quantity; order→warehouse fulfillment linkage.

---

### 4.4 Template T4 — Service Invoice (from D1) — the most system-connected template

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TAYLOR ARIZONA            Service Invoice No.  WO38957-1                     │
│ Taylor Freezer Sales of Arizona · Ph 602-276-1733 · Payment Terms 30  [N]    │
├──────────────────────────────────────────────────────────────────────────────┤
│ EQUIPMENT SERVICED                     ORDER                                 │
│  Dist. Acct No. [973202]        [N]     Order No.  [WO38957-1]     [E]~      │
│  Make  [Taylor Model RC35 Remote][N]    Date of Order [07-21-2026] [E]       │
│  Model [RC35]                   [N]     Time of Order [12:43:14 PM][E]       │
│  Serial No. [M9012291]          [N]     Store Contact [Kevin Adams][E]       │
│  Date Installation [        ]   [N]     Store Phone  [520-249-4043][E]       │
│  Voltage / PH / WC / Ground Chk [N]     Date of Service [7/23/2026] [N]      │
│  ETA Time [        ]            [N]     Time In [07:06] Out [13:05][N]       │
│  P.O. No. [        ]            [N]     Travel Start [06:16]        [N]      │
│  Service Badge No. [3202-A77]   [N]     Rate [0.00]  Hours [5.98]   [N]      │
│                                         Truck No. [T54]      [E] fieldops_…  │
│  ☑Credit ☐C.O.D. ☐Cash   ☐Service Contract ☑Scheduled                  [N]  │
│  ☐Deliver ☐Install ☐Removal  ☐P.M. ☐Other  ☐Normal Service  ☐Rewrite   [N]  │
│  Work Completed ☑Yes ☐No     Recall # [        ]                       [N]  │
├─────────────────────────────────────┬────────────────────────────────────────┤
│ CUSTOMER                            │ BILL TO                                │
│  Customer No. [C763-1]        [E]   │  Bill. [C763-1]                 [E]    │
│  Name [Culver's #710]         [E]   │  Name [Culver's #710]           [E]    │
│  Address [18810 S. Nogales Hwy][E]  │  Address [18810 S. Nogales Hwy] [E]    │
│  City [Green Valley] ST [AZ] Zip [85614]  [E] structured address             │
├─────────────────────────────────────┴────────────────────────────────────────┤
│ Reason for Service  [ Andrew's went out and evacuated the line ]      [E]~   │
├──────────────────────────────────────┬───────────────────────────────────────┤
│ SERVICE PERFORMED (narrative)  [E]~  │ PARTS & MATERIALS                     │
│  Upon arrival, left side barrel off. │ ┌────┬────────┬──────┬─────┬────────┐ │
│  Checked condenser, found comp power │ │Qty │Part No.│ Who  │Price│ Amount │ │
│  connections unplugged…              │ │    │        │ Pays │     │        │ │
│  …recharged w/ 192 oz R404…          │ ├────┼────────┼──────┼─────┼────────┤ │
│  Manager approved, ordering new relay│ │192 │T047493 │  C   │3.05 │ 585.60 │ │
│  and capacitor for Hopper compressor.│ │    │Refrigerant HFC HP62/404a     │ │
│                                      │ └────┴────────┴──────┴─────┴────────┘ │
│  [E]~ jobs.description exists, but   │  Part No. [E] SKU · Price [E] catalog │
│  is one free-text field, not the     │  Who Pays (C/M/W) [N] ← warranty split│
│  three distinct narratives printed   │  Qty consumed [E] via partsReserved/  │
│  (Reason / Performed / Follow-up).   │           consumePart()               │
├──────────────────────────────────────┴───────────────────────────────────────┤
│ MACHINE READINGS                          CHARGES                            │
│ ┌──────┬────┬─────┬─────┬─────┬─────┬──┐  Tot. Parts            585.60  [N]  │
│ │      │Visc│ Low │High │Stby │Barrl│Hp│  Tax                    53.29  [N]  │
│ │ Left │0.00│  0  │  0  │     │     │  │  Travel Fee            182.00  [N]  │
│ │ Right│0.00│  0  │  0  │     │     │  │  Labor 15-min @ 35.0   840.00  [N]  │
│ └──────┴────┴─────┴─────┴─────┴─────┴──┘  Freight/Shipping/Misc      0  [N]  │
│  All machine readings  [N]                Refrigerant Processing     0  [N]  │
│  Type of Refrigerant / Amount Recovered   Brazing Fee                0  [N]  │
│  (EPA-relevant)        [N]                Steam Clean                0  [N]  │
│                                           ─────────────────────────────      │
│ PRICE BREAKDOWN                           GRAND TOTAL             1,660.89   │
│  Bill-to Customer  C763-1   1,660.89 [N]                                     │
│  Bill-to Manufacturer  —         —   [N]  ← warranty/manufacturer claim      │
├──────────────────────────────────────────────────────────────────────────────┤
│ Service Tech [TIMOTHY BRADY] [E]  Customer Authorization ______ Title ______  │
│                                   [N] on-site signature capture              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Compliance footer: SB 478 service-charge disclosure (company-scoped)   [N]    │
│                    [ Click Here to Pay ]  → payment link             [N]     │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Field mapping — T4 (abridged to the decision-relevant rows)**

| Printed field | Proposed system field | Owning entity | Status |
|---|---|---|---|
| Service Invoice No. / Order No. | Work Order id | `fieldops_wos` | [E] |
| Customer No. / Name / Address | Account + Location | `accounts`/`locations` | [E] |
| Bill-to (separate block) | `billToAccountId` | Invoice | [N] |
| Store Contact / Phone | Contact | `contacts` | [E] |
| Make / Model / Serial No. / Install Date | Equipment record | **Equipment** | [N] Future entity |
| Dist. Acct No. | `distributorAccountNumber` | Equipment or Account | [N] |
| Voltage / PH / WC / Ground Check | Equipment electrical profile | Equipment | [N] |
| Reason for Service | `reasonForService` | Work Order | [E]~ collapsed into `description` |
| Service Performed narrative | `workPerformed` | Work Order / Job | [E]~ same collapse |
| Qty / Part No. / Description | Parts consumed | `inventory_transactions` + catalog | [E] |
| Price (per part, sell) | `price` | `partsCatalog` | [E] static, not authoritative |
| **Who Pays (C / M)** | `billingResponsibility` | Invoice Line | [N] |
| Tot. Parts / Tax | Invoice totals | Invoice | [N] |
| Travel Fee | `travelFee` | Invoice | [N] |
| 15-min increment @ rate / Hours | Labor billing | Labor Line + Rate Table | [N] |
| Time In / Out / Travel Start | Time entries | Time Entry | [N] |
| Freight / Refrigerant Processing / Brazing / Steam Clean | Ancillary charge codes | Charge Code table | [N] |
| Bill-to Customer vs Bill-to Manufacturer | Split billing | Invoice | [N] |
| Machine readings (visc, pressures, temps, voltage) | Service reading set | Service Reading | [N] |
| Type of Refrigerant / Amount Recovered | EPA refrigerant log | Refrigerant Log | [N] regulatory |
| Service Tech | Technician | `fieldops_technicians` | [E] |
| Truck No. | `vehicleId` | Vehicle | [E]~ `fieldops_inventory.locationId` for trucks; Vehicle entity is Future |
| Service Badge No. | `serviceBadgeNumber` | Employee/Technician | [N] |
| Credit/COD/Cash · Contract/Scheduled/PM/Rewrite/Recall | Work Order classification set | Work Order | [N] |
| Customer authorization signature | Signature record | [N] | [N] |
| Payment link / SB 478 footer | Company document profile | Company | [N] |

---

## 5. Consolidated gap register

Entities that must exist for these four templates to be produced. Ordered by dependency.

| # | Entity | Needed by | BusinessEntityModel status today |
|---|---|---|---|
| G1 | **Company / Operating Company** (`TAYLOR`, `VENTANA`) | all four | §5 Future — must be activated first |
| G2 | **Equipment / Serialized Asset** (make/model/serial/install/site) | D1, D3, D4 | §3 Future — *note: an active workstream already exists (Equipment Custody / Serialized Asset, ADR-010, DECISIONS #59) — this wireframe must reconcile with it, not duplicate it* |
| G3 | **Equipment Model Catalog** (sellable models, distinct from service parts) | D2, D3 | none — `partsCatalog` is service parts only |
| G4 | **Quote / Sales Agreement** + line items + signature | D2 | §2 "Opportunity/Quote" Future |
| G5 | **Sales Order** + fulfillment state (ord/ship/BO) | D3, D4 | none |
| G6 | **Pick Ticket / Fulfillment** + bin + serial assignment | D4 | none |
| G7 | **Invoice** (sales + service) + split bill-to | D1, D3 | §2 Future |
| G8 | **Pricing & Discount** (sell price authority, not `partsCatalog.price`) | D1, D2, D3 | none |
| G9 | **Tax** (rate, jurisdiction, taxability by line) | D1, D2, D3 | none |
| G10 | **Labor & Travel Billing** (rate table, increments, time entries) | D1 | none |
| G11 | **Charge Codes** (freight, brazing, steam clean, refrigerant processing) | D1 | none |
| G12 | **Warranty Terms** + manufacturer claim / "Who Pays" | D1, D3 | none |
| G13 | **Service Readings** (visc, pressures, temps, voltage) | D1 | none |
| G14 | **Refrigerant Log** (type, recovered amount) — EPA regulatory | D1 | none |
| G15 | **Payment Terms** (Net 30, Credit/COD/Cash) | all four | none |
| G16 | **Document Numbering** (per-company sequences: Q-, SO-, I-, WO-) | all four | `counters` collection exists [E] |
| G17 | **Signature Capture** (buyer, customer authorization) | D1, D2 | none |
| G18 | **Vehicle** (Truck No. as a first-class record) | D1 | §6 Future |
| G19 | **Employee** (salesperson, badge no., sales roles) | D1, D2, D3 | §8a approved architecture, unbuilt [S] |
| G20 | **Document Profile per company** (letterhead, remit-to, boilerplate, compliance footer) + **branded template variant selection** by `operatingCompanyId` | all four | none |
| G21 | **Intercompany Billing, bidirectional** (Flow 1 Taylor→Ventana service; Flow 2 Ventana→Taylor equipment; internal counterparty that is not a customer Account) | D1 on Ventana work; D2/D3 on ice machine retail | none — no precedent in codebase |
| G22 | **Equipment three-tier price ladder** — true cost (Ventana) → wholesale (to Taylor) → sales (to customer); resolved by who is buying; actual prices frozen onto the transaction. **Service transfer pricing is a separate, still-undefined basis (Q9)** | G21 | none — constrains G8's design |
| G22b | **Margin visibility control** — true cost and wholesale are internal-only and must never reach a technician or a customer-facing document | G22 | none — second driver for G35 |
| G41 | **Price change audit trail** — append-only history (actor, timestamp, from → to, reason) on entered prices and discounts; frozen once invoiced. **The control that substitutes for having no price master** | Q23c | none — platform has append-only *records* but **no field-level change history anywhere** |
| G42 | **Stored base list price per model** (tier-3 catalog value) — the prerequisite any % discount computes against | national account discounting | `partsCatalog.price` exists but is static, non-authoritative demo data |
| G45 | **Factory → Ventana inbound purchase & receiving** — where true cost enters the system, captured per serialized unit at acquisition; distinct from Taylor's parts replenishment chain | Q23d, tier 1 | none — existing `purchase_orders`/Reorder Request machinery is Taylor parts, not this |
| G46 | **Per-unit acquisition cost on the serialized asset** — immutable, specific-identification costing; margin computed against the unit's own cost, never a current or average value | Q9c/Q23d | none — binds to the ADR-010 serialized-asset workstream |
| G47 | **Sales Order / Invoice cancellation lifecycle** — `CANCELLED` status, no post-invoice price edit, replacement order linked back to the cancelled one | Q23g | reuses the Cancel/Void precedent (`reorder-request-cancellation.md`) — pattern exists, not applied here |
| G48 | **Serialized unit reservation** — a serial chosen on an order becomes unavailable to every other order; transactional, not advisory | unit allocation | precedent exists (`fieldops_inventory` available/reserved split, `inventoryService.js`) — not applied to serials |
| G49 | **Unit allocation recommendation engine** — pure function ranking available units by FIFO or best cost; computed on read, never persisted; non-binding; deviations recorded | Owner rule | matches `dispatchScoring.js` / `technicianRecommendationEngine.ts` idiom — genuinely low-cost |
| G50 | **Parts weighted-average costing** — one `averageCost` per part, recomputed on each receipt; gives parts margin without per-unit tracking | parts margin | none — **depends on an authoritative on-hand quantity, i.e. the `inventory_transactions` trusted-write path** |
| G51 | **Part supersession / manufacturer cross-reference** — one durable internal part identity, manufacturer part numbers as attributes; historical documents keep the number actually used | Owner rule | none — **conflicts with the INV-CONVERGENCE `partId == SKU` join key; must be reconciled there** |
| G52 | **Write-down** (aging resale inventory, episodic) **AND depreciation** (demo/rental/company units, periodic from an in-service date) — two distinct mechanisms; recorded events, never overwriting acquisition cost | Q53q | none — **largely deferred to Financials; data prerequisite already met by G46** |
| G52b | **Serialized unit disposition** (held for resale / in service / sold) + recorded transitions — without it, write-down vs depreciation cannot be applied correctly over a unit's life | Q53q | none |
| G56 | **Supplier / Vendor Management** — becomes load-bearing for the first time because the reserved `purchase_orders` entity is Supplier-linked | Q54q | `suppliers`/`supplier_catalog` exist but every purchasing surface so far deliberately used free text instead |
| G53 | **Credit memo / crediting function** — reversing document for an issued invoice, distinct from order cancellation | Q44q | none — Framework names Credit Memo as a revenue-bearing entity that does not exist |
| G54 | **Company-scoped cost visibility** — Taylor never sees Ventana's true cost; needs a company dimension on identity and a Rules-enforced (not UI-only) boundary | Q47q | none — `users/{uid}.role` has no company dimension; `employees.companyId` is reserved-but-unbuilt |
| G55 | **Factory PO + receiving into inventory** — full procurement flow for manufacturer purchases; where cost enters the system for both equipment and parts | Q45q | `purchase_orders` exists (Admin-SDK-only, no write path) — **naming collision to resolve deliberately** |
| G43 | **National account % discount** — one field on the Account, applied to the base price; flows into G41 | Owner rule, D3's `DISC %` column | none — **recommended first** |
| G44 | **National account price list** — agreed price per item per account, with assignment, effective dating, and a maintenance surface | Owner rule | none — **a subsystem; recommend deferring behind G43** |
| G25 | **Product-line ownership** (`owningCompanyId` on the equipment model catalog: ice machines = Ventana, Taylor equipment = Taylor; parts exempt) — a **default**, not an invariant | Flow 2 | none |
| G28 | **Controller ownership override** — append-only, reason-required, actor/timestamp-stamped; effective ownership = override ?? default, never re-derived | rule 8 | none — **DEFERRED to Financials**; only the storage shape is honored now |
| G29 | **Company Controller role** — does not exist in `ROLES` or `OPERATIONAL_ROLE` | G28 | none — **DEFERRED to Financials** |
| G30 | **Account class / buyer type** (end user vs third-party service company vs designated national account) — distinct from `salesChannel` and from `relationshipTypes`. **Reporting/classification only, NOT a Ventana pricing input** (Q23b) — off the Phase 2 pricing critical path | §3.6 | `relationshipTypes` [S] covers CUSTOMER/VENDOR only |
| G31 | **Parts-always-Taylor validation** — a parts sale is `operatingCompanyId = TAYLOR` unconditionally; encode as a rule, not a convention | rule 6 | none |
| G32 | **Account line-of-business relationship** (`lineOfBusiness[]`: `TAYLOR` / `VENTANA` / both) — optional, additive, informational, no Rules change | rule 9, reporting | reuses the `relationshipTypes` precedent [S] — **lowest-cost item in this register** |
| G33 | **Per-line-of-business salesperson assignment** on the Account (a Taylor rep and a Ventana rep are usually different people) | rule 9 | depends on Employee [S] |
| G34 | **Field/office responsive template completion** — one definition, both surfaces, building on `modules/mobile/` + Field Mode | rule 10 | mobile surface exists [E]; templates do not |
| G35 | **Field-level visibility within a document** — a technician completes work/parts/times/readings; pricing, rates, tax, and totals are office-only. Route-level `ROLE_NAV_ACCESS` cannot express this | rule 10 + T4 | none — genuinely new capability |
| G36 | **Field printing** — the *completed* form printed on site for wet signature (rung 2), plus a blank printable form (rung 3) | rule 10 | none; makes Q8 print parity load-bearing for both |
| G37 | **Photo capture of a signed form** filed against the record (rung 2) | rule 10 | none — depends on G38 |
| G38 | **File / blob storage** — signature bitmaps and photographs. No Firebase Storage usage, no `storage.rules`, no upload path exists anywhere in the codebase today | rungs 1 & 2 | none — **net-new infrastructure, largest hidden cost in rule 10** |
| G39 | **Signature-to-document binding** — signer name/title, timestamp, capture rung, acting technician, and an immutable rendering or content hash of the document as signed; append-only, never edited | rungs 1 & 2 | none |
| G40 | **On-device e-signature capture** ("signature aperture" — finger/stylus on phone) for delivery and service | rung 1, ideal state | none |
| G26 | **Inventory ownership dimension on equipment stock**, separate from location — one shared warehouse holds both companies' units | Flow 2 | none — `fieldops_inventory`/`warehouses` have location only |
| G27 | **Title-transfer event** (Ventana→Taylor at retail sale, priced, auditable) | Flow 2 | none — ADR-003 trusted-write constraint applies |
| G23 | **Consolidation & elimination** (combined owner view must not double-count intercompany revenue; intercompany excluded from or separately labeled in external sales metrics) | reporting | none — Framework-governed |
| G24 | **Sales Channel** (`RETAIL` \| `NATIONAL_ACCOUNT`) on the Sales Order + a National Accounts team role in **both** companies | D2, D3 | none |

---

## 6. Proposed sequencing (for review — not a commitment)

```
 Phase A  Quick win       G32 Account lineOfBusiness[] — optional array field, existing
                          precedent, no Rules change, no migration. Independent of
                          everything below; starts capturing reporting data now.
 Phase 0  Governance      G1 Company/Operating Company ADR  ── Tier 2, blocks everything
                          Settle the 3-field split: operatingCompanyId /
                          performingCompanyId / salesChannel  (§3.3)
                          DESIGN (not build) G21+G22 intercompany + transfer pricing
                          ── must precede G8, see below
 Phase 1  Foundations     G19 Employee · G16 numbering · G20 doc profiles + branded variants
                          G2 Equipment  (reconcile with the existing ADR-010 workstream)
 Phase 2  Sales origin    G3 model catalog · G8 pricing (rate-context shape from G22)
                          G9 tax · G15 terms · G24 sales channel · G4 Quote (T1)
 Phase 3  Sales fulfill   G5 Sales Order (T2) · G6 Pick Ticket (T3)
                          ⚠ stock posting stays blocked on Blaze / ADR-003
 Phase 4  Billing         G7 Invoice · G12 warranty & Who-Pays · G17 signature (T2/T3 → invoice)
 Phase 5  Service billing G10 labor/travel · G11 charge codes · G13 readings · G14 refrigerant
                          · G18 Vehicle  → T4 Service Invoice
 Phase 6  Intercompany    G21 BUILD Taylor→Ventana settlement · G23 consolidation/elimination
 Later    Financials      G28 Controller override · G29 Controller role  ── Owner-deferred
                          to the Financials initiative; only the storage shape is
                          honored earlier (ownership stored, never re-derived)

 Cross-cutting (applies to every template phase, not a phase of its own):
          G34 field/office responsive completion · G35 field-level visibility
          G36 blank printable form · G37 scanned attachment · G17 signature
```

T4 is *last* despite being the most system-connected, because it depends on the largest
number of net-new billing entities. T1 is first because it is the origination document and
has the highest existing-field coverage.

**The one ordering constraint that cannot be relaxed:** G21/G22 are *built* last (Phase 6)
but must be **designed in Phase 0**. Pricing (G8, Phase 2) has to be shaped as a rate
context resolved per billing relationship from the outset — a model that stores one price
per line cannot later carry both a transfer price and a customer price over the same
consumption. Getting this wrong means rebuilding pricing, quotes, orders, and invoices.

---

## 7. Open questions for the Owner (blocking the Assessment)

**Answered by the Owner on 2026-07-31** (folded into the model above; confirm the reading is right):
- **Q1 — resolved.** Option A confirmed: shared platform, separated books. Still needs the Tier 2 Company ADR.
- **Q3 — resolved.** Ventana owns **ice machine equipment**; Taylor owns **all parts, any brand**. The Flow 1 service charge therefore covers **labor AND materials** (Ventana has no parts of its own to draw).
- **Q4 — resolved in principle.** Ventana gets its own **branded templates**, not a Taylor division line. Exact legal name / remit-to / numbering prefixes still needed (Q4b below).
- **Q12 — resolved.** The intercompany relationship is **bidirectional**: service flows Taylor→Ventana, equipment flows Ventana→Taylor.
- **New:** sales attribute to Ventana by **origination**; **Taylor also runs a National Accounts team**, and the Retail-vs-National-Account flag lives **on the Sales Order**.

```
Q2.  Is `operatingCompanyId` immutable once stamped, and can a single Account be sold to
     by BOTH Taylor and Ventana? (Determines whether the field lives on the Account, on
     the transaction, or on both. The origination rule implies transaction-level — confirm.)

Q4b. Ventana's exact document identity — legal seller name, address, remit-to, tax
     profile, logo asset, and document-number prefixes for Q-/SO-/I-/WO-.

Q5.  "Who Pays" (C / M) on the service invoice — is manufacturer/warranty claim billing in
     scope for this initiative, or deferred? It is a genuine second billing party, not a flag.

--- NEW, arising from the intercompany + national-accounts direction ---

Q9.  TRANSFER PRICE BASIS — FLOW 1, service, Taylor → Ventana. Cost? Cost + markup?
     Standard labor rate? A negotiated intercompany rate card? Together with Q9b this is
     the single largest open design input — it determines the shape of the entire pricing
     model (G8/G22), and pricing is built in Phase 2, long before intercompany in Phase 6.

Q9b. RESOLVED (Owner, 2026-07-31) — a three-tier ladder on all equipment: TRUE COST to
     Ventana → WHOLESALE PRICE to Taylor (the intercompany transfer price) → SALES PRICE
     to the customer/Account. Ventana margin = wholesale − true cost; Taylor margin =
     sales − wholesale; combined = sales − true cost. (§3.5)

Q9c. PRICE LEVEL — is TRUE COST a per-SERIALIZED-UNIT fact (what Ventana actually paid for
     that specific machine, varying with freight/timing/terms) while SALES PRICE is a
     per-MODEL catalog value? Strong recommendation: model them at different levels.
     Collapsing both onto one record produces wrong margins, and it is expensive to
     unpick later. Where does WHOLESALE sit — per model, or per unit?

Q9d. Does the three-tier ladder apply to TAYLOR-OWNED equipment too, or does Taylor-owned
     equipment run a two-tier ladder (cost → sales) with no wholesale leg because there is
     no intercompany transfer? "On all equipment" is ambiguous on this point.

Q9e. Can the wholesale price be OVERRIDDEN on a specific deal, or is it always the
     standing ladder value? (If overridable, it needs the same frozen-onto-the-transaction
     and audit treatment as the ownership override in §3.7.)

Q12b. Is the ice machine ownership rule keyed on PRODUCT CATEGORY ("ice machines") or on
     MANUFACTURER/BRAND? Rule 5's phrase "no matter the brand" implies brand is a
     meaningful axis in this business, so the discriminator needs to be explicit before
     G25 is modeled. Category and brand will not always agree.

Q17. THE MIRROR CASE — when VENTANA sells a TAYLOR-owned unit on a national account, does
     Ventana buy it from Taylor (Flow 2 in reverse)? Rule 4 only covers Taylor retail-
     selling a Ventana ice machine. If the mirror exists, the transfer model is fully
     symmetric; if not, it is asymmetric by design and should be documented as such.

Q18. Are there product lines beyond "ice machines" and "Taylor equipment"? G25 should be
     a lookup driven by the model catalog, not two hardcoded cases — but only if the
     business genuinely expects more lines.

Q19. When a Ventana-owned ice machine sits in a Taylor warehouse, is that CONSIGNMENT
     (Ventana bears the carrying cost/risk until sale) or a stocking arrangement? This
     affects whether the owner dimension is purely informational or financially bearing.

Q20. Does a Taylor retail sale of a Ventana ice machine generate service obligations that
     flow back as Flow 1 (Taylor services its own retail customer on a unit Ventana
     originally owned)? If Taylor now owns the unit and the customer, this is likely a
     PURE Taylor transaction with no intercompany service leg — confirm.

--- NEW, arising from Ventana external sales + the Controller override ---

Q21. MIXED-COMPANY ORDERS. A third-party service company wants an ice machine (Ventana)
     and parts (Taylor) at the same time. Does the platform allow ONE order that splits
     into two invoices across two companies' books, or must these be two separate orders
     from the start? Two orders is far simpler and safer; one mixed order is friendlier to
     the buyer. This is a genuine product decision, not a technical one.

Q22. WHO DESIGNATES a customer as a "specially designated national account" for Ventana,
     and is that designation the same field as `salesChannel = NATIONAL_ACCOUNT` on the
     order, or a separate account-level designation with its own authority? (§3.6)

Q23. Do third-party SERVICE COMPANIES service their own equipment — i.e. Flow 1 does not
     apply to them? And do they buy Taylor parts at a different (trade/dealer) price than
     an end customer? If yes, buyer type becomes a PRICING input, which raises G30's
     priority to Phase 2 alongside G8.

Q23b. RESOLVED (Owner, 2026-07-31) — no other groups trade with Ventana; every Ventana
     buyer pays wholesale, similar to Taylor. Tier 2 is Ventana's SINGLE outbound price;
     tier 3 (sales price) belongs to Taylor as reseller. Ventana never sells at retail.
     Consequence: buyer type (G30) is NOT a Ventana pricing input. (§3.5, §3.6)

Q23c. RESOLVED (Owner, 2026-07-31) — NEITHER. Wholesale is not stored at all; it is
     entered at time of sale, with an audit trail of sales and of changes (G41). No price
     master, no price book, no pricing engine for wholesale. (§3.5)

Q23d. RESOLVED (Owner, 2026-07-31) — cost is cost relative to Ventana, captured at
     acquisition, and it VARIES OVER TIME (the same model can cost differently week to
     week). It is therefore a per-serialized-unit acquisition fact, immutable once
     recorded. This also resolves Q9c: cost is per UNIT, list price is per MODEL. (§3.5)

Q23e. Should the entry screen show a REFERENCE or SUGGESTED price (e.g. the last wholesale
     used for that model, or a typical value) — displayed for guidance, never enforced,
     never a stored master? Cheap, reduces keying errors on the one number that shifts
     margin between two companies' books. Recommend yes.

Q23f. AUDIT SCOPE — does "audit sales and history of changes" mean:
       (a) a price-change trail on the transaction only, or
       (b) a broader sales audit view (who sold what, at what margin, over time), or
       (c) both?
     (a) is a data-capture capability; (b) is a reporting surface with margin visibility
     implications (G22b). They are different builds and should be scoped separately.

Q23g. RESOLVED (Owner, 2026-07-31) — once invoiced, prices are FROZEN. Changing them means
     CANCELLING the order and creating a new one; there is no amendment or revision path.
     Reuses the existing Cancel/Void discipline exactly. (§3.5)

Q9c. RESOLVED with Q23d — true cost is per SERIALIZED UNIT (an acquisition fact that
     varies over time); list/sales price is per MODEL (a catalog value). Wholesale remains
     unstored and hand-entered per deal (Q23c). Three tiers, three different homes.

--- NEW, arising from national account pricing ---

Q37. PRICE LIST *and* % DISCOUNT, or one or the other? If an Account can carry both,
     precedence must be explicit — which wins, or do they compound? Undefined precedence
     produces silently wrong invoices. Recommend: ship the % discount (G43) first as one
     field, and treat price lists (G44) as a later, separate initiative.

Q38. WHICH TIER does national-account pricing apply to — Taylor→customer (tier 3) only, or
     also Ventana's outbound wholesale to its designated national accounts? The earlier
     "wholesale similar to Taylor" phrasing suggests this may be exactly how that
     similarity varies. If it applies to both, the mechanism must be tier-aware.

Q39. Does national-account pricing apply to PARTS as well as equipment? Parts are always a
     Taylor sale (rule 6), and national-account parts discounts are very common. If yes,
     G42's stored base price is needed for parts too — and `partsCatalog.price` is
     currently static, non-authoritative demo data, which would have to become real.

Q40. DISCOUNT SCOPE — is the % a single account-wide number, or can it vary by product
     category / line of business (e.g. 12% on equipment, 20% on parts)? One number is a
     field; per-category is a small table. Cheap to decide now.

Q41q. Can a discount be OVERRIDDEN on an individual line at sale time (D3's per-line
     `DISC %` column implies yes)? If so, the account-level value is a DEFAULT that
     pre-fills, and the line value is authoritative — with the override captured in G41.

--- NEW, arising from per-unit cost and the freeze/cancel rule ---

Q42q. ANSWERED (Owner, 2026-07-31) — parts DO need margin. Recommended method: WEIGHTED
     AVERAGE COST (one cost per part, recomputed on each receipt), which requires no
     ability to distinguish individual small items. Confirm this method over FIFO layers.
     Note it depends on an authoritative on-hand quantity, i.e. the `inventory_transactions`
     trusted-write path — it cannot be built on the static demo catalog. (§3.5)

Q43q. Should a replacement order LINK BACK to the order it replaced (`replacesOrderId`),
     so the audit shows why a new order exists? Recommend yes — cheap, and without it a
     cancel-and-recreate looks like two unrelated orders.

Q44q. RESOLVED (Owner, 2026-07-31) — yes, there must be a CREDITING function. A credit
     memo is a distinct reversing document, not a status change on the original invoice
     (G53). Residual: does crediting belong in this initiative or with the deferred
     Financials work? It is revenue-bearing, which argues for Financials.

Q45q. RESOLVED (Owner, 2026-07-31) — a full FACTORY PO and RECEIVING-INTO-INVENTORY
     process is required for manufacturer purchases, not minimal cost capture (G55).

Q46q. Are there acquisition costs beyond the factory invoice that belong in true cost —
     freight, duty, prep? "True cost" implies landed cost. If so, cost is assembled from
     several inputs rather than copied from one invoice line.

--- NEW, arising from the allocation recommendation ---

Q47q. RESOLVED (Owner, 2026-07-31) — SALES and MANAGEMENT roles see cost, but scoped by
     company: **Taylor sees only its own cost from Ventana (wholesale), never Ventana's
     true cost.** This is a data ISOLATION boundary, not just a UI permission (G54). It
     needs a company dimension on identity and a Rules-enforced read boundary — client-side
     hiding is not sufficient under this platform's own standing rule. (§3.5)

Q48q. Is the allocation strategy a company-wide DEFAULT, a per-user preference, or chosen
     per line at sale time? Recommend a configurable default with per-line override.

Q49q. Should "best cost" mean LOWEST cost (maximum margin on this deal) — with the
     understood trade-off that it accumulates expensive units — or is there a smarter
     intended rule (e.g. oldest-of-the-cheapest, or age-weighted)? "Best" is doing
     ambiguous work in the phrasing and should be pinned down.

Q50q. Does allocation also need to consider LOCATION (a unit in the right warehouse beats
     a marginally cheaper one three states away) and freight cost to the customer? If yes,
     the recommendation is multi-factor rather than a single-key sort.

Q51q. RESOLVED (Owner, 2026-07-31) — recommend at quote, RESERVE AT ORDER. Quoting never
     ties up stock; the reservation binds when the order is placed (G48).

--- NEW, arising from parts costing, supersession, depreciation, and isolation ---

Q52q. RESOLVED (Owner, 2026-07-31) — superseded parts MERGE into one pool at weighted
     AVERAGE COST. One part, one quantity, one reorder point, one continuous margin
     history. The merge reuses G50's formula rather than needing a separate rule. Still
     to reconcile: INV-CONVERGENCE's `partId == SKU` join key, which a changing
     manufacturer number breaks — durable identity must be an internal part id.

Q53q. RESOLVED (Owner, 2026-07-31) — BOTH. Write-down for aging resale inventory
     (episodic, judgement-based) AND depreciation for demo/rental/company-owned units
     (periodic, formulaic from an in-service date). Two mechanisms, not one with a switch.

Q54q. RESOLVED (Owner, 2026-07-31) — the factory PO IS the reserved `purchase_orders`
     entity. No fourth object. `reorder_purchase_orders` is untouched. Pulls in two
     consequences: a Tier 2 `firestore.rules` change (it denies all client writes today),
     and Supplier/Vendor Management becoming load-bearing for the first time (Q58q).

Q55q. RESOLVED (Owner, 2026-07-31) — isolation does NOT extend past cost, for now. A
     field-level boundary, not a tenancy design. Significant de-scoping: Phase 0 is
     unaffected. Recommend still storing cost separably so the boundary can widen later
     without a rewrite.

Q56q. See Q56b — the answer given conflicts with rules 5/6 and needs disambiguation.

--- NEW ---

Q56b. RESOLVED (Owner, 2026-07-31) — WORKING ASSUMPTION: parts are NOT bought from the
     factory for Ventana. Reading A. Ventana POs are equipment only; Taylor buys parts.
     Rules 5/6 intact. Flagged "for now," so the design keeps a seam: `operatingCompanyId`
     lives on the PO itself, and the parts side is built as "one owner, always Taylor"
     rather than "owner is not a concept."

Q57q. UNIT DISPOSITION — a unit can move from held-for-resale to in-service (demo/rental,
     starts depreciating) and later be sold. Does a serialized unit need an explicit
     disposition state alongside its cost, and is that transition a recorded event?
     Recommend yes to both — otherwise the two treatments in Q53q cannot be applied
     correctly to the same unit over its life.

Q58q. SUPPLIER / VENDOR MANAGEMENT — the reserved `purchase_orders` entity is
     Supplier-linked, but every purchasing surface built so far deliberately avoided the
     `suppliers`/`supplier_catalog` collections (free-text `supplierName` instead). A real
     factory PO makes Supplier load-bearing. Is building Supplier/Vendor Management in
     scope here, or does the factory PO start with free-text manufacturer names and adopt
     Supplier later? The latter matches existing precedent and is much cheaper.

--- DEFERRED to the Financials initiative (Owner, 2026-07-31) — NOT blocking ---

Q24. Company Controller role — security role vs operational role; per-company or global;
     one-directional or both.
Q25. Override granularity — product line / serialized unit / single transaction.
Q26. Effective-dating and whether an override can ever be retroactive.
Q27. Whether an already-sold unit's ownership can be overridden (recommend: frozen at
     title transfer).
     ↳ Carried here so the Financials initiative inherits them intact. The only thing
       this initiative must honor meanwhile: store effective ownership as a real field
       with a default — never recompute it from the catalog on read.

--- NEW, arising from account relationships + field/office/paper access ---

Q28. SALESPERSON ASSIGNMENT — is per-line-of-business assignment in scope now, or is
     `lineOfBusiness[]` alone enough for this phase with assignment following once
     Employee (G19) exists? Recommend the latter: ship the classification first.
     (Shape now resolved: a rep is single-company, so the Account carries one assignment
     per line of business and the company is implied by whom you pick.)

Q28b. RESOLVED (Owner, 2026-07-31) — not normally, but assume a rep CAN carry both.
     `salesCompanies[]` is multi-valued; the assignment eligibility check WARNS rather
     than blocks. (§3.8)

Q29. FIELD-LEVEL VISIBILITY (G35) — confirm the split. Proposal: a technician in the field
     completes work performed, parts used, times, and machine readings; pricing, rates,
     tax, totals, and margin are office-only and not rendered on the field surface at all.
     Is that the right line, and are there roles that need a middle tier (e.g. a lead tech
     who quotes on site)? This must not be solved by widening technician route access.

Q30. OFFLINE CAPTURE — must field completion work without connectivity and sync later?
     This is a substantial architectural decision affecting every write path in the
     initiative. This document assumes NO offline requirement until told otherwise; if it
     is required, it should be decided before Phase 2, not retrofitted.

Q31. PAPER PATH — RESOLVED (§4.0a). Both a printable form and a photographed signed form
     filed against the record; capture is by phone camera, not a desk scanner; what is
     printed at rung 2 is the COMPLETED form. Residual: when a rung-3 paper form is
     re-keyed, is the paper or the record authoritative, and does the record need a
     "originated on paper" provenance flag?

Q32. Does the field surface need to CREATE these documents, or only complete ones the
     office originated? Create-in-field is meaningfully more work (numbering, customer
     lookup, pricing) than complete-in-field.

--- NEW, arising from the signature ladder ---

Q33. FILE STORAGE (G38) — signature bitmaps and photographs need blob storage, which this
     platform has never used (no Firebase Storage, no `storage.rules`, no upload path).
     Before this can be sized: (a) confirm Storage is available on the live project, and
     (b) RESOLVE THE BLAZE DISCREPANCY — `BusinessEntityModel.md` §4a states trusted
     server work is blocked on Blaze, while the Auth Modernization workstream records
     Blaze as already live with functions deployed. Both Storage and the trusted-write
     path depend on the answer. This is a verification task, not a design decision.

Q34. NARROWED by Q36 — since no send-for-signature capability will exist, the T2 Sales &
     Security Agreement signature is either (a) captured IN PERSON by the salesperson via
     the same ladder, or (b) handled on paper entirely outside the system. Which?
     "Emailed for signature" is no longer an available answer.

Q35. RETENTION & EVIDENTIARY WEIGHT — how long must signed artifacts be kept, and does the
     business need to distinguish an on-device signature from a photographed wet signature
     in any downstream process (disputes, warranty claims, manufacturer billing)? If yes,
     the capture rung is not just metadata, it is a business field.

Q36. RESOLVED (Owner, 2026-07-31) — IN-FIELD, IN-PERSON ONLY. No signature requests, no
     remote approvers, no send-for-signature subsystem, no third-party e-sign
     integration. Recorded as a deliberate scope exclusion in §4.0a, not an omission.

Q10. INTERCOMPANY SETTLEMENT CADENCE — is Taylor→Ventana billed per Work Order, or
     accumulated and settled periodically (monthly statement)? Per-WO is simpler to model
     and audit; periodic is more common in practice. This changes whether Doc A is an
     invoice or a settlement line.

Q11. Can Ventana sell RETAIL, or is Ventana always NATIONAL_ACCOUNT? (§3.3's fourth
     combination — if Ventana is national-accounts-only, that is a validation rule, not a
     free choice.)

Q12. Does Ventana ever PERFORM service for Taylor (the reverse direction), or is the
     intercompany flow strictly one-way Taylor → Ventana? One-way is far simpler; building
     it symmetric "just in case" is scope creep unless the business genuinely does it.

Q13. On a Ventana job, who owns the EQUIPMENT record and its service history — Ventana,
     or the shared registry with a Ventana tag? (§3.4 proposes shared+tagged; confirm.)

Q14. COMBINED REPORTING — does the Owner need a single cross-company view, and if so must
     intercompany revenue be ELIMINATED (true consolidated total) or shown separately
     per company? Naively summing Taylor + Ventana double-counts every service job.

Q15. Does the National Accounts team need its own operational role and permissions (e.g.
     `NATIONAL_ACCOUNTS` alongside SALES_MANAGER/SALES_ASSOCIATE in OPERATIONAL_ROLE), or
     is setting `salesChannel` open to any sales user?

Q16. Does `salesChannel` DRIVE anything beyond reporting — national-account pricing
     schedules, approval requirements, different terms? If it drives pricing, it becomes a
     pricing input (G8) rather than a classification, which raises its priority.

Q6. Serialized equipment — confirm these templates should build on the EXISTING Equipment
    Custody / Serialized Asset workstream (ADR-010, DECISIONS #59) rather than introduce a
    parallel equipment model. Strong recommendation: reuse, do not fork.

Q7. Is pricing authoritative in this platform, or does it come from an external
    ERP/accounting system? `partsCatalog.price` is static demo data and is NOT a pricing
    authority. If pricing lives externally, every template above becomes a
    provider-contract surface under the Enterprise Business Metrics Framework's five-state
    rule, not a locally-computed total.

Q8. Do these templates need to PRINT to match the existing paper forms (customer-facing
    PDF parity), or is on-screen capture sufficient for phase one? Print parity is a
    substantial, separate deliverable.
```

---

## 8. Review record

```
Gate:      Wireframe (pre-Assessment)
Authorizes: NOTHING — no code, schema, Rules, index, migration, or deployment
Revision:  Rev 2 (2026-07-31) — added §3.5 intercompany model, branded template
           variants, three-field company/channel split, gaps G21–G24, Phase 6,
           and questions Q9–Q16. Q1 and Q4 resolved by the Owner.
           Rev 3 (2026-07-31) — intercompany is BIDIRECTIONAL: added Flow 2
           (Ventana→Taylor ice machine equipment on a Taylor retail sale),
           product-line inventory ownership (ice machines = Ventana; ALL parts =
           Taylor, any brand), inventory ownership as a dimension separate from
           location, title-transfer events, gaps G25–G27, questions Q9b/Q12b/
           Q17–Q20. Q3 and Q12 resolved by the Owner.
           Rev 4 (2026-07-31) — Ventana sells externally to third-party service
           companies and designated national accounts (§3.6); parts are always
           SOLD by Taylor's parts department, not merely owned (rule 6);
           Controller ownership override makes product-line ownership a
           DEFAULT rather than an invariant (§3.7); gaps G28–G31; questions
           Q21–Q27.
           Rev 5 (2026-07-31) — added §3.8 Account line-of-business relationship
           (reuses the existing `relationshipTypes` precedent; promoted to a
           standalone Phase A quick win), §4.0 field/office/paper access
           modality, gaps G32–G37. Controller role + Q24–Q27 DEFERRED to the
           Financials initiative per Owner direction; only the ownership storage
           shape is honored now. New questions Q28–Q32.
Next gate: Assessment, after the remaining questions are answered
Reviewers: Owner (business model) · ChatGPT (architecture/governance)
Blocking:  Q9 (the SERVICE transfer basis, Taylor→Ventana) is now the single
           remaining blocking pricing answer — Q9b's equipment ladder is
           resolved. Q29 (field-level visibility) and Q30 (offline) follow:
           both architectural, both cheaper to decide than to retrofit.
           Rev 6 (2026-07-31) — salespeople are single-company (§3.8); added
           §4.0a signature capture ladder (on-device e-signature ideal;
           print → wet sign → photograph as fallback; blank paper outside
           process), gaps G38–G40, questions Q28b/Q33–Q36. Q31 resolved.
           Surfaced a Blaze/Storage documentation discrepancy needing
           verification (Q33).
Not blocking: Q24–Q27 (Controller) — deferred to Financials by Owner direction.
Ready now:  G32 `lineOfBusiness[]` (Phase A) is independently buildable and
           needs no answer to anything above.
           Rev 7 (2026-07-31) — Q28b resolved: `salesCompanies[]` is
           multi-valued, eligibility WARNS rather than blocks (third use of the
           same array idiom). Q36 resolved: signature capture is in-field,
           in-person only — send-for-signature ruled OUT as a deliberate scope
           exclusion, which narrows Q34 and keeps G38 the only new
           infrastructure the ladder introduces.
           Rev 8 (2026-07-31) — Q9b resolved: three-tier equipment price ladder
           (true cost → wholesale to Taylor → sales to customer). G22 revised
           from an open rate context to a bounded named ladder; added G22b
           margin visibility; new questions Q9c–Q9e and Q23b. Q9 (service
           transfer basis) remains the one blocking pricing answer.
           Rev 9 (2026-07-31) — Q23b resolved: Ventana has ONE outbound price
           (wholesale) to every buyer; tier 3 is Taylor's reseller price and
           Ventana never sells at retail. Ventana is structurally a wholesaler.
           Buyer type (G30) drops off the pricing critical path. New Q23c: is
           wholesale one standing price or negotiated per buyer?
           Rev 10 (2026-07-31) — Q23c resolved: wholesale is NOT stored, it is
           entered at time of sale; no price master for wholesale at all
           (matches the `supplierName` free-text precedent). Added G41 price
           change audit trail — the control that substitutes for having no
           price master, and a capability the platform does not have in any
           form today. New questions Q23d–Q23g.
           Rev 11 (2026-07-31) — national account pricing added as a SCOPED
           EXCEPTION to "no price master": a % discount field (G43, recommended
           first) or price lists (G44, a subsystem — defer). Surfaced the
           dependency that a % discount requires a STORED BASE PRICE (G42),
           which promotes Q9c to a blocking prerequisite. New questions
           Q37–Q41q. D3's existing `DISC %` column is the paper ancestor.
           Rev 12 (2026-07-31) — Q23d/Q9c resolved: true cost is a per-
           SERIALIZED-UNIT acquisition fact that varies over time, immutable,
           specific-identification costing (serialization avoids FIFO/LIFO for
           equipment entirely). Q23g resolved: prices frozen at invoice; change
           = cancel + new order, reusing the Cancel/Void discipline. Added the
           Factory→Ventana inbound flow (G45), per-unit cost (G46), order
           cancellation lifecycle (G47), serialized reservation (G48), and the
           FIFO/best-cost allocation recommendation engine (G49). New questions
           Q42q–Q51q.
           Rev 13 (2026-07-31) — Q47q resolved and escalated: cost visibility
           is COMPANY-SCOPED data isolation (Taylor never sees Ventana's true
           cost), needing a company dimension on identity and a Rules-enforced
           boundary (G54). Q42q: parts DO need margin — recommended weighted-
           average costing (G50). Q45q: full factory PO + receiving (G55).
           Q44q: crediting required (G53). Q51q: reserve at order. Added part
           supersession (G51) and inventory depreciation/write-down (G52).
           New questions Q52q–Q56q.
           Rev 14 (2026-07-31) — Q52q: superseded parts MERGE at weighted
           average cost. Q53q: BOTH write-down and depreciation (two
           mechanisms), adding unit disposition (G52b). Q54q: the factory PO IS
           the reserved `purchase_orders` entity — pulling in a Tier 2 Rules
           change and making Supplier load-bearing (G56). Q55q: cost-only
           isolation, NOT a tenancy design — Phase 0 protected. Q56q's answer
           conflicts with rules 5/6 and is raised as Q56b rather than resolved
           by assumption. New questions Q56b, Q57q, Q58q.
           Rev 15 (2026-07-31) — Q56b resolved as a WORKING ASSUMPTION: parts
           are not bought from the factory for Ventana (Ventana POs are
           equipment only). Rules 5/6 intact; the parts-no-owner-dimension
           simplification is preserved. Two seams recorded so a future reversal
           is cheap. **All blocking questions except Q9 are now answered.**
Verify:    Q33's Blaze discrepancy is a read-only check against the live
           project, not a design decision — worth clearing early since file
           storage (G38) is a prerequisite for the whole signature ladder.
```
