# Handoff: Account family — North Star design source
## VERSION: Account North Star P1 — DESIGN AUTHORITY. Not an implementation order.

There was no Owner-approved Account North Star; PR #1511 merged an Account composition using the general grammar. This package establishes the actual visual authority. #1511 was inspected as behavioral evidence only, never as visual truth.

## Authorities
- **Visual authority:** `North Star - Account P1.dc.html` (1a desktop 1440, 1b tablet 768, 1c phone 375).
- **Behavioral authority:** TaylorService-spec/Taylor_Parts @ main. Key files: domain/accountNorthStar.js, accountAttentionProjection.js, accountArView.js, accountHealthStrip.js, accountIntelligence.js, accountPortfolio.js, accounts.js, contacts.js, commercialProfile.js; modules/accounts/AccountDetail.jsx (post-#1511) + section components; metadata/definitions/account.js, accountPage.js, accountPageComponents.js; hooks/useAccountAr.js, useAccountServiceActivity.js, useContactsForAccount.js, useLocationsForAccount.js.

## Core composition (desktop, top to bottom)
1. **Utility line** — context breadcrumb; "Read-checked {time} · Refresh" (useAccount is not a subscription — no live badge, matching the merged page's honest choice). Rule pair below.
2. **Identity (A1)** — kicker: `Customer · {relationships} · {lines of business}` in words (accountClassification, definition order). Title = the NAME, serif 40px (no governed reference exists; document id never a fallback — DECISIONS #106). Fact row, the 5 header facts: status **sentence** (accountStatusSentence + tone), owner (resolved identity, never the stored id), billing address, customer # (only when present), terms digest (paymentTerms · taxStatus · PO required). Unnamed account renders "Account — no name recorded".
3. **Status, not lifecycle (A4 / ND-11)** — one muted sentence states why no spine is drawn (accountLifecycle().reason). No chevrons, no stage timestamps, no transition implication. Status is otherwise only in the fact row — stated once (NS-P4).
4. **Standing strip** — exactly buildAccountHealthStrip's three metrics: Open work orders, Outstanding AR (per-currency lines joined with " · ", never summed), Past due count. DENIED renders "Not available to you", UNAVAILABLE "Couldn't be read", zero renders (a real answer). No pipeline/backlog/equipment tiles — no account-scoped read exists; the strip says so in one muted sentence instead of fake tiles.
5. **Attention (A3)** — directly below standing, before everything it warns about. Two sections, NEVER merged or ranked (ACCOUNT_ATTENTION_SECTION_ORDER): "Accounts Receivable" (overdue invoices: number, outstandingText, daysOverdueText, deep link to the AR section) and "Past Due" (workOrderPastDueItem verbatim). Per-source honest notes when a source is loading/denied/unavailable. Renders nothing when both sources READY and empty — silence is the healthy state, no green "all clear" banner.
6. **Intelligence (A9)** — one line INSIDE the attention surface, beneath the facts it explains: deriveAccountIntelligence's observedFact. Explanation only; allowedRecommendation is null and the design renders no recommendation slot, no action, no chat. Silent when NO_ATTENTION or SOURCE_DEGRADED (fail-closed). When attention is empty the whole surface (attention + intelligence) is absent.
7. **Body grid (A2)** — minmax(0,1fr)/340px/56px. MAIN: Commercial activity (Opportunities + Sales Orders as one section, two reads, same row grammar; Dollars in the canonical money vocabulary; opportunity rows honestly non-navigable with the stated reason — no opportunity page exists), Accounts receivable (per-invoice table: position words + tone, outstanding, day counts only for OVERDUE), Service activity (open WOs with status words, schedule, technician; equipment honestly absent with the stated reason + workspace link). RAIL: **Contacts first (A5)** with live count, primary badge (primaryContactState; MULTIPLE renders the ambiguity warning), Add/Import; Locations + Add; Commercial profile (dl: owner, terms, tax status — always shown, absent resolves to Unknown, never silently Taxable —, PO required only when a real boolean, invoicing, billing contact resolved, currency); Notes & identifiers collapsed by default.
8. **Actions** — Edit customer (primary; opens the one governed AccountForm; per-field pencils focus it), Add Contact, Add Location (+ Import in the contacts section). No status-transition buttons (none exist). Governed fields (paymentTerms, taxStatus) show admin-only editability; Rules remain enforcement.

## Related-record weight (A6/A7)
Preview rows + workspace links; never six equal tables. Compact summary: standing strip. Preview rows: commercial activity (5 most recent), service activity (5 open), AR (all invoices — the read is already bounded; if the callable reports over-bound, the section renders its own "unavailable — too many to summarize truthfully"). Full tables live in workspaces. Contacts/locations render fully (small by nature). AR placement (A8): combination — overdue slice in Attention, balance in Standing, full table in main. One fact one rendering: the same formatMinor/moneyDisplay output everywhere.

## Responsive intent (A10)
1440: as 1a. 1024: rail 220px, body gap 40px. 768 (1b): nav drawer; body becomes two equal columns pairing rail content beside main sections; tables full-width below. 375 (1c): answer stack — identity → attention → standing tiles → "Call someone" (primary contact + call affordance) → activity cards; profile/AR/notes behind "More"; Edit into sheet menu. 320: metric tiles single-column. Never a squeezed desktop table — rows become cards at ≤744.

## Honest states
loading / customer unavailable (read failure, retry) vs not found (distinct sentences — never collapsed) / denied metrics ("Not available to you") / AR unavailable incl. over-bound / attention source degraded (per-source note; intelligence silent) / no contacts (never a fabricated primary) / multiple primaries (warning, never silently pick one) / empty commercial activity ("No opportunities or orders yet" + where creation lives) / archived (status sentence "closed, and read-only by convention"; composition unchanged; Edit still offered — no rule forbids it, see decision A-D3).

## Implementation mapping (descriptive only)
| Visual section | Classification |
|---|---|
| Identity, status sentence, classification words, terms digest | EXISTING EOS TRUTH (accountNorthStar.js, commercialProfile.js) |
| Standing strip (3 metrics, per-currency) | EXISTING EOS TRUTH (accountHealthStrip.js) |
| Attention two-section surface + deep links | EXISTING EOS TRUTH (accountAttentionProjection.js) |
| Intelligence line, explanation-only | EXISTING EOS TRUTH (accountIntelligence.js + accountModelInterpretation.ts) |
| Commercial activity rows | EXISTING EOS TRUTH (account-scoped callable reads; capability-gated fail-closed — renders only where opportunity.read/salesOrder.read active) |
| AR table | EXISTING EOS TRUTH (listAccountInvoiceAr via accountArView) |
| Service activity rows | EXISTING EOS TRUTH (account-scoped WO reads) |
| Contacts/Locations + Add/Import + focus handoff | EXISTING ACTION (modals, governed writes) |
| Edit + per-field pencils | EXISTING ACTION (AccountForm → updateAccount; Rules enforce governed fields) |
| Opportunity row navigation | PRODUCT GAP (no route — REGISTRATION_PENDING; rows non-navigable with stated reason) |
| Equipment on the account | HONEST UNKNOWN (no account-scoped read; sentence + workspace link) |
| Pipeline $, order backlog, equipment count tiles | PRODUCT GAP (no reads; deliberately absent from strip) |
| Recent-activity timeline | PRODUCT GAP (crm.activity.read inactive catalog-wide; section renders only where activated — no universal timeline invented) |
| "Call" affordance on phone | EXISTING EOS TRUTH (tel: on stored phone; no telephony integration implied) |

## Owner decisions required
- **A-D1 — Attention silence.** When nothing needs attention the surface is absent entirely (design intent: silence = health). Alternative: a one-line "Nothing needs attention" receipt. Pick one; the design ships silence.
- **A-D2 — AR visibility for non-finance roles.** finance.read gates AR + Outstanding/Past-due metrics. Design renders DENIED as "Not available to you" in place. Confirm that a salesperson seeing denied slots (rather than a page with no financial geography) is the intended presentation.
- **A-D3 — Archived accounts.** "Read-only by convention" — no rule blocks editing an archived account. Design keeps Edit offered. Deciding archived should actually lock is a behavioral change (new enforcement), not a presentation one.
- **A-D4 — Prospect emphasis.** Same composition for prospects (AR/service usually empty, honest empties render). A prospect-specific composition (pipeline-led) needs the account-scoped opportunity read active — defer or rule.

## Comparison to PR #1511 (merged Account page)
- **MATCH:** identity-as-name, no-lifecycle sentence, attention position + two-section rule, health strip content, statement-once status, commercial profile facts, contacts/locations CRUD + focus handoff, fail-closed capability gating, distinct unavailable-vs-not-found.
- **PRESENTATION ADJUSTMENTS (to conform to this authority):** Contacts move from bottom-of-main into the rail top (A5); standing strip renders as one ruled row, not tiles; attention + intelligence share one bordered surface; classification moves into the kicker; terms digest joins the header facts; AR gets its own main-column section header ("Accounts receivable") rather than living inside a generic Financials block; body proportions to 1fr/340/56; serif/rule/typography per family tokens; equipment-absence sentence added to Service activity.
- **IMPLEMENTATION INVENTED SOMETHING:** nothing found — #1511 is disciplined; no fabricated data or unauthorized actions detected in the inspected surface.
- **MISSING DESIGN REQUIREMENT (in #1511, now specified):** phone/tablet compositions (currently a stacked desktop), the "Call someone" mobile pattern, per-source attention notes' visual treatment, denied-metric presentation, prospect empty-state copy.
- **PRODUCT GAPS (shared):** opportunity route, account-scoped equipment/pipeline/backlog reads, activity timeline capability.

## Do-not-invent list
No lifecycle chevrons/timestamps/transitions; no merged/ranked attention; no AI recommendations or follow-up actions; no fabricated metrics (pipeline, LTV, health score, churn risk); no summed multi-currency; no $0.00 for unknown; no document ids; no fake primary contact; no collections workflow, payment promises, credit actions; no universal timeline; no telephony integration beyond tel:.
