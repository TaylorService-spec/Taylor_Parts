# Handoff: Sales Agreement family — North Star design source

## VERSION: Sales Agreement North Star **P1v2** — DESIGN AUTHORITY. Design only; no implementation, no authority changes.

Supersedes P1v1. P1v1's core composition is preserved; this revision corrects dimension truth,
acceptance-evidence language, unproven legal and business-policy copy, and the shell/route
contradiction, and it verifies every repository-derived claim against current `main`.

---

## Visual authority

`North Star - Sales Agreement P1v2.dc.html` in this folder.

| Artboard | Frame | Rendered width (measured) | Content |
|---|---|---|---|
| **1A** | desktop | **1440px** | ACCEPTED, Sales Order exists — the canonical hierarchy |
| **1B** | tablet | **768px** | DRAFT, acceptance blocked — the working surface, with the line disclosure drawn |
| **1C** | phone | **375px** | ACCEPTED |
| **1D** | phone | **375px** | DRAFT, acceptance blocked — the primary working state on a handheld |
| **1E** | — | state studies | Twelve honest states as compact treatments |

**Dimension truth.** `box-sizing: border-box` is set globally, and every frame was measured in a
browser after authoring: 1440 / 768 / 375 / 375 rendered exactly, with `scrollWidth − clientWidth
= 0` in all four (no horizontal overflow anywhere). Desktop decomposition, also measured:
224 nav + 1216 content → 28px padding each side → **1160 inner** → **820 main / 40 gap / 300 rail**;
the commercial table measures 820px. P1v1 labelled 1440/768/375 while composing roughly
1640/792/407, so its responsive claims could not be checked against the artifact at all.

---

## Core hierarchy (1A, top to bottom)

Utility line (Read-checked · Refresh) → rule pair → **identity group** → lineage strip → body grid
`minmax(0,1fr) / 300px`, gap 40:

- **MAIN** — agreed lines + money ladder · Acceptance · What this agreement became
- **RAIL** — Commercial terms · Why this agreement exists · Customer · Record

The identity group is ranked rather than run together as one metadata sentence:

1. `SA-2026-000003`
2. **Accepted · Desert Sun Beverage Co. · $25,946.05 USD committed** (one line, 16px)
3. Customer PO · Owner · From OPP-…  (12.5px, muted)

No KPI cards. Typography and spacing carry the ranking.

---

## Design decisions (SA-D1 – SA-D12)

- **SA-D1 Identity.** Kicker "Sales Agreement · Negotiated commercial commitment"; title =
  `salesAgreementNumber`, falling back to the truthful generic "Sales Agreement" and never to the
  document id. The state word stands alone with tone; PO and owner are third-rank facts.
- **SA-D2 State treatment.** **No LifecycleBand.** DRAFT → ACCEPTED | DECLINED is a gate with
  terminal outcomes, not a progression; chevrons would manufacture a journey. State is stated once
  in the identity group; the Acceptance section records the one event that matters.
- **SA-D3 Value prominence.** Total committed appears as an identity fact and as the anchor of the
  ladder. Never a dashboard tile. A draft with an unpriced line claims **no** subtotal, total or
  balance — "Incomplete — 1 line has no price", never a partial sum, never `$0.00`.
- **SA-D4 Lines responsive.** 1440 = full grid (Line · Qty · Unit · Committed) + ladder.
  768 = the Unit column moves onto each line's own **drawn** disclosure (44px rows).
  375 = ruled rows: strong reference, amount opposite, commercial facts beneath.
- **SA-D5 Line identity is the reference.** A line stores `ref` and **no display name**. The
  reference is the strong element; a catalogue-resolved name sits beside it in muted type, marked
  `†`, and where it is unresolved the reference stands alone. See **SA-G4**.
- **SA-D6 Terms placement.** Rail, first section: `customerPO`, `isLease`, `fulfillmentIntent` in
  words, `shipVia`, `currency`; instructions as prose beneath. Absent fields are omitted, never
  dashed. No payment-terms or tax-treatment field exists on the agreement and none is invented.
- **SA-D7 Acceptance evidence.** Three labelled facts — Agreement state / Recorded / Action
  executed by — then two short statements: *"EOS records the governed acceptance event. No
  customer-signature evidence is stored on this Agreement."* and *"Accepted agreements are
  read-only."* The engine's pricing invariant is **not** on this section (see SA-D12).
- **SA-D8 Money ladder, two jobs, visually separated.**
  *Sale composition* — subtotal, shipping, installation charge, tax, **Total committed** (17px,
  ruled). Then, indented behind a left rule and one step smaller, *Credits recorded at commitment* —
  down payment, trade-in, **Balance after credits**, with the note that this is the agreement's own
  arithmetic and **not** an accounts-receivable balance. Balance never outranks Total committed.
- **SA-D9 Provenance.** Rail section "Why this agreement exists" (OPP number + need text +
  channel/owner) plus the lineage strip Account → OPP → **SA** → SO. Never the embedded
  Opportunity page.
- **SA-D10 Downstream.** Main section "What this agreement became": SO number linked, "created
  from these committed lines and prices", state words. Before an order exists: *"No Sales Order.
  One is created when the Opportunity is closed as won, which requires this agreement to be
  accepted first."* Neutral, not a failure; no invented Create button, and no promise of
  inevitability — the close command can still refuse.
- **SA-D11 Actions by state × permission.**
  DRAFT, all priced → primary **Record acceptance**, secondary **Edit draft**.
  DRAFT, unpriced → Record acceptance disabled carrying the view model's own reason, which names
  every unpriced line; the attention strip repeats it.
  ACCEPTED → primary is navigation to the order (or the SA-D10 sentence); **no edit affordance at
  all** — the engine forbids editing a terminal record, so the control is absent, not disabled.
  DECLINED → no actions; the record stays readable.
  Permission is the *different* sentence: protected + disabled, "You do not have permission to
  accept Sales Agreements." State and permission never collapse.
- **SA-D12 Deliberately absent.** No AI panel, no risk or health score, no approval workflow, no
  e-signature/send-to-customer, no Presented/Rejected/Superseded/Expired/Void states, no discount /
  margin / cost / commission, no tax-calculation UI, no FX selection, no payment schedule, no PDF
  generation. Backend policy explanation is absent from the accepted record: the acceptance-time
  pricing invariant is DRAFT-blocking behaviour and belongs to the draft blocker and the
  implementation handoff, not to the accepted record's evidence.

---

## Acceptance evidence rule (binding on any implementation)

EOS proves exactly three things about acceptance: **the state is ACCEPTED**, **`acceptedAtMillis`**
(server clock), and **`acceptedByUid`** (the EOS principal who invoked the command). Nothing else.

Permitted vocabulary: *Accepted · governed acceptance · acceptance recorded · accepted state ·
action executed by · read-only · committed prices · EOS does not store customer-signature evidence.*

Forbidden unless new governed evidence exists: *binding · the customer accepted · the customer's
commitment · signed · electronically accepted · e-signature*, and any phrasing implying EOS holds
external customer evidence. The phrase *customer signature* appears only in the explicit negative.

**Whole-artifact copy sweep performed.** P1v1's "Accepted — the commitment is binding and
read-only", "Accepted — binding, read-only", "recording the customer's commitment", "A changed mind
is a new agreement" and "A new conversation is a new agreement, drafted from the opportunity" are
all removed. No occurrence of *binding*, *signed*, *electronically*, or *customer accepted* remains
in P1v2.

---

## Responsive behaviour

- **1440** — nav 224, content 1160, main 820 / rail 300 / gap 40. The rail and gap were reduced
  from P1v1's 340/56 so the agreed lines gained the space; the lines are the dominant content.
- **768** — identity group stacks; rail becomes a 232px column; the lines table sheds its Unit
  column and each line carries a **rendered** disclosure showing `unit × quantity`. Rows ≥44px
  because the disclosure is a touch target.
- **375** — ruled rows rather than bordered cards; boxes only where they carry a tap target.
  Both the accepted record (1C) and the working draft (1D) are designed.
- **Touch targets, measured, not asserted.** Every primary command is 48px; every disclosure row
  is 44px. The breadcrumb and lineage links measure 12–13px and are **deliberately** below 44px:
  they are contextual navigation, not handheld primary controls. The ≥44px claim is scoped to
  controls, and this exception is documented rather than papered over.

---

## Shell / route decision boundary

These are two different authorities and P1v2 keeps them apart.

**RECORD CONTENT AUTHORITY** — everything inside the content column: identity group, agreed lines,
money ladder, acceptance evidence, downstream lineage, rail, and every state treatment. This is
what P1v2 is authority for.

**SHELL / ROUTING ASSUMPTION** — how the record is reached. Current truth: there is **no**
Sales Agreement route. `field-ops-app-vite/src/App.jsx` routes
`/customers/opportunities/:opportunityId` and `/customers/opportunities/sales-order/:salesOrderId`;
no agreement path exists, and `navConfig.js` has no Sales Agreements item under CRM/Sales. The
agreement renders today as `OpportunityAgreementCard` on the Opportunity record page, with
`SalesAgreementPanel` as the workspace's fuller surface.

**Navigation decision, made deliberately:** the desktop mock highlights **Opportunities**, which is
truthful for how the record is reached today, and **adds no Sales Agreements nav item**. A nav item
would be a product change; a mock does not get to make it. The artboard carries this in its own
caption so the shell cannot silently decide the product question.

**Owner has since decided that question** — the Sales Agreement becomes a first-class routed record
page (see *Owner decision — RESOLVED*). The artifact still depicts current reachability, because
the route does not exist yet; the decision governs where reachability is going, and introducing it
is the implementation pass's work.

**The shell brand is current truth, verified:** `Verenward` is live in
`shared/brand/VerenwardMark.jsx`, `navigation/AppRail.jsx` and `shared/ui/AppHeader.jsx`. It is
retained as shell context, not redesigned.

---

## AUTHORITY VERIFICATION

Every material design-driving fact, with its current source in `Taylor_Parts @ main` (verified for
P1v2, not carried forward from P1v1).

```text
Agreement lifecycle
SOURCE: functions/src/salesAgreement/salesAgreementLifecycle.ts
TRUTH USED: SALES_AGREEMENT_STATES = DRAFT | ACCEPTED | DECLINED; checkAgreementTransition refuses
            any move out of ACCEPTED/DECLINED and any move back to DRAFT
DESIGN EFFECT: no lifecycle chevrons; terminal presentation; ACCEPTED shows no edit affordance

Agreement state words
SOURCE: field-ops-app-vite/src/metadata/definitions/salesAgreement.js (state.enumLabels)
TRUTH USED: DRAFT "Draft" / ACCEPTED "Accepted" / DECLINED "Declined"
DESIGN EFFECT: the state word rendered in the identity group; no invented adjectives

DECLINED reachability                                                          >>> PRODUCT GAP
SOURCE: functions/src/index.ts exports; functions/src/salesAgreement/salesAgreementCallables.ts
TRUTH USED: only createSalesAgreement / updateSalesAgreementDraft / acceptSalesAgreement exist.
            NO decline command. DECLINED is modelled and legal but nothing can produce it.
DESIGN EFFECT: Declined shown ONLY as a compact state study, explicitly labelled
               "modelled, unreachable". Named SA-G5. (P1v1 presented it as an ordinary state.)

Agreement line fields
SOURCE: field-ops-app-vite/src/domain/salesAgreementView.js (lineView);
        functions/src/salesAgreement/salesAgreementReadService.ts (projectLine)
TRUTH USED: lineId, kind (EQUIPMENT_MODEL|PART|SERVICE), ref, quantity, unitPriceMinor,
            extendedMinor (recomputed qty x unit), condition, warranty, estimatedArrivalMillis.
            unitPriceMinor is NULL when unpriced, never 0.  NO name/description field exists.
DESIGN EFFECT: the reference is the line's strong identity; qty / unit / committed columns;
               condition + warranty + arrival as the subline; "Not priced" never "$0.00"

Line display name                                                              >>> PRODUCT GAP
SOURCE: functions/src/salesAgreement/productReferenceSearchService.ts
TRUTH USED: displayName is returned by the PICKER's search, at pick time. It is not stored on the
            line and is not returned by the agreement read.
DESIGN EFFECT: names rendered muted and marked with a dagger footnote; unresolved names are simply
               absent. Named SA-G4.

Money ladder fields and arithmetic
SOURCE: functions/src/salesAgreement/salesAgreementCommands.ts (computeAgreementTotals);
        domain/salesAgreementView.js
TRUTH USED: subtotalMinor = sum of extendedMinor, and is NULL unless every line is priced.
            totalMinor = subtotal + shipping + installCharge + tax, NULL when subtotal is NULL.
            balanceMinor = total - downPayment - tradeIn, NULL when total is NULL.
            shipping / installCharge / tax / downPayment / tradeIn default to 0 when unset.
DESIGN EFFECT: the two-block ladder; "Incomplete — N lines have no price" instead of any total;
               Balance subordinated to Total committed and explicitly not an A/R balance

Money display
SOURCE: field-ops-app-vite/src/domain/moneyDisplay.js; domain/money.js
TRUTH USED: integer minor units to the renderer; one display path; a known currency renders in
            normal presentation. currency is server-set to "USD"
            (salesAgreementCommands.ts) and is not caller-supplied.
DESIGN EFFECT: real "$" amounts, tabular figures, "USD committed" stated once in the identity group

Commercial terms fields
SOURCE: domain/salesAgreementView.js; metadata/definitions/salesAgreement.js
TRUTH USED: customerPO, isLease (boolean), fulfillmentIntent DELIVER|INSTALL|BOTH with enumLabels
            "Deliver" / "Install" / "Deliver and install", shipVia, currency,
            shippingInstructions, specialInstructions
DESIGN EFFECT: the rail dl, in words; "Deliver and install" is the definition's own label

Acceptance
SOURCE: functions/src/salesAgreement/salesAgreementCommands.ts (buildAcceptSalesAgreement);
        salesAgreementCallables.ts (acceptSalesAgreement)
TRUTH USED: sets state ACCEPTED, acceptedAtMillis = server nowMillis, acceptedByUid = caller uid.
            Refuses if any line is unpriced. No commercial payload. No customer-side evidence of
            any kind is captured or stored.
DESIGN EFFECT: the three-fact evidence block and its exact wording; the signature negative

Acceptance eligibility + its reason
SOURCE: domain/salesAgreementView.js (agreementAcceptability, agreementIsEditable)
TRUTH USED: returns a REASON, not a boolean; names every unpriced line by ref; also refuses on an
            already-accepted, declined, or empty-line agreement. DRAFT is the only editable state.
DESIGN EFFECT: the disabled Record acceptance button carries the view model's own sentence

Acceptor identity
SOURCE: field-ops-app-vite/src/domain/actorDisplayName.js (resolveActorDisplayName,
        UNKNOWN_ACTOR_DISPLAY_NAME); hooks/useEmployeeDirectory.js
TRUTH USED: a uid resolves to the Employee displayName, or to the constant "Unknown user".
            A raw Firebase uid must NEVER reach a non-Admin DOM (F-UID-1).
DESIGN EFFECT: "Action executed by R. Amado"; the unresolved study shows exactly "Unknown user"
               (P1v1's invented "an authorized user (name unavailable to you)" is removed)

View states
SOURCE: domain/salesAgreementView.js (SALES_AGREEMENT_VIEW_STATE)
TRUTH USED: LOADING, DENIED, UNAVAILABLE, NONE, NOT_ENABLED, READY — six, deliberately distinct
DESIGN EFFECT: six of the 1E studies, each its own sentence; not-enabled never reads as denied,
               unavailable never reads as "no agreement"

Capabilities
SOURCE: field-ops-app-vite/src/access/salesAgreementCapabilityAccess.js
TRUTH USED: salesAgreement.create / .updateDraft / .accept / .read, resolved in ONE request;
            fail-closed; disabled-reason strings are defined there
DESIGN EFFECT: permission sentences quoted from that file; Create appears only with .create

Environment enablement
SOURCE: functions/src/access/environmentCapabilityOverrides.ts
TRUTH USED: all four capabilities are ELIGIBLE and are activated for eos-platform-sandbox
            (projectId "eos-platform-sandbox"). Production is triple-blocked.
DESIGN EFFECT: NOT_ENABLED is a real state to design, not a permanent condition.
               NOTE: the comment block in hooks/useSalesAgreement.js still says the capability is
               granted in NO environment. That comment is stale; the override registry and
               App.jsx are current. Flagged, not fixed — this is a design pass.

Identity / numbering
SOURCE: functions/src/salesAgreement/salesAgreementNumbering.ts
TRUTH USED: SA-YYYY-###### from counter sales_agreements_YYYY; allocated once, immutable, never
            derived from the document id or from the Opportunity's or Sales Order's number
DESIGN EFFECT: SA-2026-000003 as the title; the unnumbered fallback study

One agreement per Opportunity
SOURCE: salesAgreementCallables.ts persistCreateSalesAgreement step 3
TRUTH USED: an in-transaction duplicate check REFUSES a second agreement:
            "Opportunity X already has a Sales Agreement. Edit that draft rather than creating a
            second." Create is also refused on a LOST Opportunity, and is NOT gated on a stage.
DESIGN EFFECT: the NONE study says exactly one is permitted; and it is why revision of a terminal
               agreement is a real gap rather than a workflow (SA-G6)

Sales Order trigger — exact order of governed conditions
SOURCE: functions/src/opportunity/closeOpportunityAsWon.ts;
        functions/src/salesAgreement/agreementToSalesOrder.ts (assertAgreementConvertible)
TRUTH USED: the Sales Order is created by the OPPORTUNITY's close-as-won command (or by
            createSalesOrderFromOpportunity once outcome is already WON). Its preconditions, in
            refusal order: the agreement exists -> its sourceOpportunityId matches -> its accountId
            matches the Opportunity's -> its state is ACCEPTED -> it has lines. There is NO
            fallback to Opportunity lines or expectedValue.
DESIGN EFFECT: "One is created when the Opportunity is closed as won, which requires this agreement
               to be accepted first." Acceptance is a PRECONDITION, not the trigger, and the copy
               promises no inevitability. (P1v1's tablet copy inverted this.)

Sales Agreement read paths
SOURCE: functions/src/salesAgreement/salesAgreementReadService.ts
TRUTH USED: getSalesAgreementForOpportunity (one equality predicate, limit 1) and
            getSalesAgreementContext (BY AGREEMENT ID) both exist and are client-wired
            (services/salesAgreementCommandClient.js). There is no list/index read.
DESIGN EFFECT: sharpens SA-G1 — the by-id read a routed record page needs ALREADY EXISTS; only the
               route is missing. And it confirms SA-G3.

Route + host surface
SOURCE: field-ops-app-vite/src/App.jsx (routes); navigation/navConfig.js;
        modules/sales/OpportunityDetail.jsx; modules/sales/OpportunityAgreementCard.jsx
TRUTH USED: routes are /customers/opportunities/:opportunityId and
            /customers/opportunities/sales-order/:salesOrderId. No agreement route. No Sales
            Agreements nav item. The agreement renders as a card on the Opportunity record page.
DESIGN EFFECT: the shell/route boundary above; nav highlights Opportunities. SA-G1 names the gap;
               the Owner has since chosen to close it with a first-class routed record page, which
               the implementation pass builds — the artifact still depicts today's reachability.

Shell brand
SOURCE: shared/brand/VerenwardMark.jsx; navigation/AppRail.jsx; shared/ui/AppHeader.jsx
TRUTH USED: "Verenward" is the current shell identity
DESIGN EFFECT: retained as shell context; not redesigned
```

### HONEST UNKNOWN

- **Account and location display names.** The agreement projection carries `accountId` and
  `locationId` — ids, not names. Rendering "Desert Sun Beverage Co. · Broadway Plant" assumes a
  separate governed read that the agreement surface does not itself perform. Stated as an
  assumption, not claimed as agreement truth.
- **Owner name.** `ownerEmployeeId` is an Employee doc id; `domain/actorDisplayName.js`'s
  `resolveEmployeeIdentity` is the current resolver and returns loading / "Owner name unavailable" /
  a name — those states are honest and distinct and must not collapse to a guess.
- **`installChargeMinor` when it is 0 or null.** A computed agreement has 0; a legacy document may
  have null. The design omits the row in both cases, so no `$0.00` is ever asserted about an
  unknown — but the two cases are genuinely indistinguishable in the projection.
- **`condition` and `warranty` value vocabulary.** `AGREEMENT_LINE_CONDITIONS` is `NEW | USED` and
  the source itself marks it `ARTIFACT_DETAIL_PENDING`; the projection stores free strings.
  "12 mo parts & labour" is an illustrative value, not a governed enum.

---

## Product gaps

Named, and kept as gaps. A gap is not a design brief.

- **SA-G1 — Standalone Sales Agreement record route. → RESOLVED (Owner, 2026-08-26).** No
  `/…/sales-agreement/:id` and no nav item exist today; the agreement is reached from the
  Opportunity record page. The **by-id read already exists** (`getSalesAgreementContext`), so this
  is a routing and navigation question, not a data question. **Owner direction: the Sales Agreement
  becomes a first-class routed record page.** See the Owner decision section below for the exact
  scope of that authorization.
- **SA-G2 — External / customer presentation and acceptance evidence.** EOS holds no signature,
  no sent/viewed/presented evidence, and no customer-facing surface. Named for roadmap. **Not
  designed here** — no signature or document behaviour is proposed.
- **SA-G3 — Agreement list / workspace / index read.** Only by-opportunity and by-id reads exist.
  Browsing agreements outside their Opportunity would be a new read. **Not designed here.**
- **SA-G4 — Line display-name resolution.** Lines store a reference and no durable display name;
  the picker's `displayName` exists only at pick time. A record page that wants names needs a
  catalogue read. **This stays a design recommendation, visibly classified as one** — the dagger
  footnote in 1A is the mechanism. Until governed readable-name resolution exists, the reference is
  the identity. **A duplicate display name must not be persisted onto the line to satisfy the mock.**
- **SA-G5 — DECLINED is unreachable.** The state is modelled, its transition is legal, and its
  label exists — but no command produces it. **No decline command is to be created, and Decline is
  never shown as an available user action**; the state study stays documented as *modelled,
  currently unreachable*. Later Owner/product question, per the decision section above.
- **SA-G6 — No post-acceptance revision path.** ACCEPTED and DECLINED cannot be edited, and a
  second agreement for the same Opportunity is transactionally refused. So under current authority
  EOS has **no** governed path for changing commercial commitment after terminal acceptance. P1v1
  asserted "a changed mind is a new agreement"; that behaviour is not supported and the copy is
  removed. **Do not invent revise / supersede / duplicate / reopen / replace-agreement /
  create-a-second-Agreement affordances.** Later Owner/product question, per the decision section.

**Gap vs. recommendation.** SA-G1/G2/G3/G5/G6 are product gaps — the system cannot currently do the
thing. SA-G4 is a design recommendation about a gap that already has an honest fallback. SA-G1 now
has an approved direction; a decided gap is still a gap until it is built.

---

## Owner decision — RESOLVED (2026-08-26)

The question put to the Owner was a product-navigation decision:

> Should the Sales Agreement North Star become a first-class routed record page now, or should this
> composition initially live within the governed Opportunity workspace?

**DECISION: FIRST-CLASS ROUTED RECORD PAGE.**

The Sales Agreement stays strongly connected to its originating Opportunity, but the Opportunity
does not own the permanent Agreement record UX. The commercial object relationship is
`Opportunity → Sales Agreement → Sales Order`, with each object keeping its own record identity and
page purpose.

**What this authorizes, and what it does not.** It settles the North Star product direction. It
does **not** authorize routing or platform reconstruction. Building the route belongs to the later
North Star implementation pass, and that pass must compose the existing governed read and action
authority — the by-id read already exists, so no new read is implied.

**Consequence for this artifact.** The 1A shell continues to highlight *Opportunities* and adds no
Sales Agreements nav item, because that is where the record is reached from *today*. The artifact
depicts current reachability; the Owner decision governs where reachability is going. Introducing
the route and its navigation entry is implementation work, not something a design mock enacts.

SA-G2 and SA-G3 remain non-blocking roadmap gaps. **SA-G5 (no decline command) and SA-G6 (no
post-acceptance revision path) are new since P1v1.** Neither blocks this North Star; both are
recorded as later Owner/product questions:

- SA-G5 — should EOS support a governed decline action, or should the unreachable `DECLINED` model
  state be removed and reconciled?
- SA-G6 — what is the governed business process when commercially agreed terms must change after an
  Agreement reaches a terminal state? This needs deliberate domain design and must not be
  accidentally solved in the presentation layer.

---

## Follow-up cleanup items (not in this PR)

- **Stale capability commentary.** `field-ops-app-vite/src/hooks/useSalesAgreement.js` carries a
  comment block stating that `salesAgreement.read` is granted in no environment ("which today is
  EVERY environment"). `functions/src/access/environmentCapabilityOverrides.ts` and `App.jsx` show
  all four Sales Agreement capabilities activated for `eos-platform-sandbox`. The comment is stale.
  Deliberately **not** fixed here — this is a docs-only design PR and touching that file would put
  product code in the diff.

---

## Cross-object consistency

Shared grammar: rule pair, serif reference title, bronze kicker, ranked identity group, contextual
rail, evergreen-ruled tables, chevron vocabulary **only where a real lifecycle exists**.

Different hierarchy per object, and the difference is the point:

- **Opportunity** leads with stage chevrons and the next action — *pursuit*.
- **Sales Agreement** leads with agreed lines, the money ladder and the acceptance record, and has
  **no chevrons** — *commitment: a gate, not a journey*.
- **Sales Order** leads with fulfillment chevrons and operational work — *execution*.

Relabelling any one of the three as another would visibly fail, because their strongest sections
are different objects' truths.

---

## Implementation mapping

### EXISTING EOS TRUTH (renderable today)
Identity + `salesAgreementNumber`, `state`, `accountId` / `locationId` / `ownerEmployeeId`, lines
(`kind` / `ref` / `quantity` / `unitPriceMinor` / `extendedMinor` / `condition` / `warranty` /
`estimatedArrivalMillis`), the full ladder (`subtotal` / `shipping` / `installCharge` / `tax` /
`total` / `downPayment` / `tradeIn` / `balance` minor + `currency`), `customerPO` / `isLease` /
`fulfillmentIntent` / `shipVia` / `shippingInstructions` / `specialInstructions`,
`sourceOpportunityId`, `salesOrderId`, `acceptedAtMillis`, `acceptedByUid`.

### EXISTING EOS ACTION
`updateSalesAgreementDraft` (DRAFT only, bounded field allowlist), `acceptSalesAgreement` (DRAFT,
every line priced, no commercial payload), navigation to Opportunity / Sales Order / Account.
`createSalesAgreement` lives on the Opportunity surface, not here.

### NOT AN ACTION HERE
Creating the Sales Order (the Opportunity's close-as-won owns it), declining (no command exists),
editing a terminal agreement (refused by the engine), presenting or sending to a customer.

### IMPLEMENTATION-ONLY NOTES (deliberately kept off the record page)
The acceptance-time pricing invariant — the engine refuses acceptance while any line is unpriced —
is DRAFT-blocking behaviour. It belongs to the draft blocker copy and to this handoff. It is not
acceptance evidence and does not appear on the accepted record.

---

## Exact P1v1 → P1v2 changes

| # | Change | Severity |
|---|---|---|
| 1 | Global `border-box`; frames recomposed and **measured** at true 1440 / 768 / 375; desktop's artificial 1360 inner cap removed | P0 |
| 2 | "binding" removed everywhere — desktop and phone state sentences now read "Accepted" / "Accepted agreements are read-only" | P0 |
| 3 | Acceptance copy rewritten to what EOS proves; "recording the customer's commitment" removed; signature negative kept and separated | P0 |
| 4 | **AUTHORITY VERIFICATION** section added; every repository-derived claim re-verified against current `main` | P0 |
| 5 | Shell/route contradiction resolved: record-content authority separated from shell/routing assumption; no nav item invented; SA-G1 restated and sharpened (the by-id read already exists) | P1 |
| 6 | Verenward confirmed as current shell truth and retained | P1 |
| 7 | Desktop width hierarchy re-derived: nav 248→224, rail 340→300, gap 56→40, main = 820 | P1 |
| 8 | Identity header regrouped into three visual ranks instead of one five-fact metadata row | P1 |
| 9 | Acceptance turned into a three-fact evidence block plus two short statements | P1 |
| 10 | Engine pricing-invariant sentence moved off the accepted record into the draft blocker / handoff | P1 |
| 11 | Money ladder split into *Sale composition* vs *Credits recorded at commitment*, with Balance subordinated and explicitly not A/R | P1 |
| 12 | Tablet line disclosure **drawn** (one line expanded, 44px rows) instead of described in prose | P1 |
| 13 | **New artboard 1D — phone DRAFT / blocked acceptance** | P1 |
| 14 | 44px claim measured and scoped; the breadcrumb/lineage exception documented | P1 |
| 15 | Phone lines de-carded: ruled rows, boxes only where they carry a tap target | P1 |
| 16 | Downstream copy corrected to the exact governed order — acceptance is a precondition of the Opportunity's close-as-won, which is the trigger | P1 |
| 17 | "A changed mind is a new agreement" / "A new conversation is a new agreement" removed; the unsupported revision path named as **SA-G6** | P1 |
| 18 | 1E expanded from six prose notes to **twelve visual state treatments** | P1 |
| 19 | Line identity corrected to the stored **reference**; catalogue names marked and gapped as **SA-G4** | new finding |
| 20 | DECLINED reclassified as modelled-but-unreachable and gapped as **SA-G5** | new finding |
| 21 | Unresolved acceptor now uses the governed constant "Unknown user" (F-UID-1) instead of invented copy | new finding |

---

## Acceptance checklist (for the eventual implementation pass)

- [ ] Whole-composition side-by-side vs 1A (Design + Owner)
- [ ] No chevrons; state stated once, with tone, in the identity group
- [ ] Money: one display path, minor units, currency-aware; a draft with an unpriced line claims no total
- [ ] Balance renders subordinate to Total committed and never as an A/R balance
- [ ] Acceptance copy contains no signature, legal-conclusion, or customer-action language
- [ ] Actions match state × permission with distinct sentences; accepted and declined offer no edit
- [ ] All six view states reachable and distinct; 375 has no horizontal overflow; every primary control ≥44px
- [ ] Line identity is the stored reference; a name renders only when actually resolved
