# Handoff: Opportunity family — North Star design source
## VERSION: Opportunity North Star P1 — DESIGN AUTHORITY for a presentation-layer migration. No backend changes.

## Authorities
- **Visual authority:** `North Star - Opportunity P1.dc.html` in this folder (1a desktop 1440, 1b phone 375, 1c states).
- **Behavioral authority:** TaylorService-spec/Taylor_Parts @ main. Key files: domain/opportunityLifecycle.js (stages, allowedActions, stageProgress, deriveAttention, pipeline/views), opportunityFieldModel.js (four data classes, section model), opportunityCommandOutcome.js; hooks/useOpportunities.js, useOpportunityTransitions.js (idempotency, WON→closeOpportunityAsWon), useOpportunitySectionSave.js; access/useOpportunityCapabilities.js, opportunityWriteReadiness.js; modules/sales/OpportunityLifecycleControl.jsx; metadata/definitions/opportunity.js; functions/src/opportunity/* (read service, commands, atomic close, numbering).

## Composition (desktop)
1. Utility line ("Read-checked · Refresh" — the read is a one-shot callable, refetch() is the refresh; no live badge) → rule pair.
2. **Identity**: kicker `Opportunity · {channelLabel}`; title = opportunityNumber ("Opportunity — not numbered" pre-numbering; NEVER the document id); serif subtitle = `need` (the nearest human name; omitted when absent, never fabricated). Facts: commercialState (stage words + tone; Decision draws attention tone), customer (resolved account name, link to Account; "Customer — name unavailable" when unresolved — see O2), **expected value as a bare number with "(no currency recorded)"** — the field stores a plain number with no currency; a symbol the data does not justify is never rendered (see O1) —, expected close + days open (derived from createdAtMillis), owner (resolved or UNRESOLVED_REFERENCE_LABEL; never the employee id).
3. **Stage chevrons** — the real six-stage governed lifecycle via stageProgress(); this family legally gets chevrons. The ONE legal advance (allowedActions().advanceTo) renders as the clickable step "Advance to {label}"; everything else static. Terminal badge for Won/Lost.
4. **Action cluster**: at DECISION the primary is "Mark Won → creates the Sales Order" (closeOpportunityAsWon — atomic, returns salesOrderId/Number, `recovered` case worded honestly); Mark Lost outlined (legal from any open stage). At earlier stages the advance chevron IS the primary; Mark Won absent (not legal), Mark Lost quiet. Closed: no actions, "Closed — no further lifecycle actions." Write-readiness off: protected+disabled with the seam's reason. All transitions through useOpportunityTransitions (idempotency keys preserved); onChanged → refetch, never client-side row patching.
5. **Attention strip** — deriveAttention() verbatim (NO_NEXT_ACTION / CLOSE_OVERDUE / CLOSE_SOON / DECISION_PENDING) + the stored nextAction text + "Update next action" (opens the section edit). Presentation of existing derivations — not a recommendation engine, and not labeled as one.
6. **Body 1fr/340/56.** MAIN: Customer need (textarea section, Edit section), Solution (kind/ref/qty table; lines carry NO prices — the one-line disclosure explains estimated-value-only pricing and that "Quoting" is a stage, not a document: **EOS has no quote object**, so no quote list, no fake quote cards), "When this closes" (the governed conversion explained; after Won, the Sales Order link renders here and in the fact row), Activity (honest gap — no activity read exists; created/updated dates are the only timeline facts; see O3). RAIL: Customer (account link + status; primary contact from the ACCOUNT's contacts with tel:/mailto: — the opportunity stores no contact; see O4), Commercial details (channel/value/close/owner; Edit), Qualification ("Not configured" — the ratified seam, empty until Product ratifies a schema; nothing invented), Record (number, created, updated; "not recorded" honesty).
7. **Editing**: read mode → per-section Edit → focused edit surface → Save/Cancel through the governed section-save (version check on updatedAtMillis; conflict = honest "someone else edited" retry, never silent overwrite). Stage is never a select (LIFECYCLE_ACTION class).

## Mobile (1b)
identity → stage in words ("stage 6 of 6") → value → next-action strip → actions (Mark Won primary at Decision; Call = real `tel:`; 44px+ targets) → solution digest → need → details behind More. No horizontal scroll.

## Action architecture (all existing; none invented)
PRIMARY: Advance to {next} (transitionOpportunity ADVANCE) or Mark Won at Decision (closeOpportunityAsWon). SECONDARY: Mark Lost (transitionOpportunity OUTCOME LOST), section Edits (updateOpportunity, version-checked). CONTEXTUAL: Call (tel:), Email (mailto:), Account/Sales Order navigation. UNAVAILABLE: everything when write-readiness disabled (protected + reason) or closed. NOT RENDERED (no path exists): Create quote, Add note/activity, Schedule visit, Contact-customer workflow, probability, source/campaign attribution (no fields exist).

## Implementation reality matrix
| Concept | Classification |
|---|---|
| Identity, stage chevrons + one legal advance, Won/Lost, atomic Won→SO with link, attention derivation, next action, section editing with version check, capability + write-readiness gating, channel/value/close/owner facts, solution lines, need, record dates | LIVE TODAY |
| Per-opportunity ROUTE (/…/opportunities/:id) | PRODUCT GAP — the workspace at /customers/opportunities is the only route; this page composition currently lives as the workspace's detail pane. Restoring rowNavigationTo needs the real route first (O5) |
| Account NAME resolution in the governed read | FOUNDATION EXISTS — read returns accountNameById: {} today; fact renders "name unavailable" (O2) |
| Primary contact card | FOUNDATION EXISTS — account contacts read exists but is not composed into this surface today (O4) |
| Activity timeline | PRODUCT GAP — audits exist server-side, no read serves them; notes/calls have no home (O3) |
| Currency on expected value | PRODUCT GAP — plain number, no currency field (O1) |
| Quotes | DOES NOT EXIST — stage only; no quote object anywhere (stated in-page, no slot faked) |
| Probability, source/campaign, qualification fields | DO NOT EXIST — probability/source not designed; qualification renders its ratified "Not configured" seam |

## Product decisions (named, for Owner)
- **O1 — Value needs a currency.** expectedValue is a bare number. Either ratify USD and store it (write validators + backfill decision) or keep the honest "(no currency recorded)" annotation. Design ships the annotation; a $ appears only when the data justifies it.
- **O2 — Resolve the customer name.** mapOpportunityReadResult hard-codes accountNameById to {}. Ship name resolution in the read (or denormalize at write) so the header names the customer; until then "name unavailable" renders.
- **O3 — Opportunity activity read.** Server-side audit events exist; decide whether to expose a bounded read (stage changes, edits, Won/Lost) for the Activity section. Notes/calls/emails are a separate capability decision (crm.activity is inactive).
- **O4 — Compose the Account's primary contact** into the rail (existing useContactsForAccount read, presentation-only composition — but it adds a read to this surface; confirm).
- **O5 — Real per-opportunity route.** Give the family /customers/opportunities/:id so Account related-lists and the Sales Order back-link can navigate. Restore the two removed rowNavigationTo declarations only after the route exists.

## Do-not-invent list
No currency symbols on unpriced numbers; no quotes/quote cards; no probability, weighted pipeline, forecasts; no fabricated activity, presence, or AI recommendations (deriveAttention's four reasons are the entire "next best action" vocabulary); no stage select; no client-side stage mutation; no second pipeline derivation; no document ids; no contact invented on the opportunity; no auto-saved notes.

## Acceptance checklist
- [ ] Whole-composition side-by-side vs the 1a artifact (Design + Owner)
- [ ] Chevrons: exactly one clickable step, only when legal + write-ready; Won only at Decision; closed offers nothing
- [ ] Won path shows the created/recovered Sales Order link immediately (command result) and durably (refetched row)
- [ ] Value renders bare number + annotation everywhere (list, header, rail — one rendering)
- [ ] All O1–O5 slots render their truthful states; no dead buttons
- [ ] Mobile: no horizontal overflow, tel:/mailto: real, targets ≥44px
- [ ] No new client authority; transitions only via useOpportunityTransitions; edits only via the version-checked section save
