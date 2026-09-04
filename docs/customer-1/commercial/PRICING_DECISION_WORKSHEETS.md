# Pricing Decision Worksheets — One Per Revenue Line

**Status: DRAFT — NOT A PRICE, NOT A QUOTE, NOT AN OFFER, NOT ACCEPTED.**
**Decision owner: Verenward Owner. Taylor accepts or rejects; Taylor does not set the price.**
**Gate: `C1-COMM-01`.**

Six revenue lines are named in the `C1-COMM-01` close condition: implementation,
subscription, support, founding-customer treatment, change requests, and
billable custom work. This document is one worksheet per line. A worksheet
states the inputs, the cost drivers it inherits from the cost model, the
structural options with their trade-offs, and ends in a single named question
only the Owner can answer.

No worksheet recommends an option, and no worksheet contains a number. Any
number here would be invented, because every cost input in
`COST_TO_SERVE_MODEL.md` is still `UNKNOWN`.

## How to use a worksheet

1. Answer `CD-01` (loaded labor rate) and `CD-02` (Taylor scale inputs) first.
   Without both, every worksheet's inputs stay unquantified and the structural
   choice is being made blind.
2. Choose the **structure** (how the line is charged) before the **level** (how
   much). Structure is the durable decision; the level can be revised at a
   renewal, the structure usually cannot.
3. Record the answer in `DECISION_REGISTER.md`, not here. This document is a
   worksheet, not a record of decisions.

Reading the columns: "Trade-off" is what the structure costs Verenward or
Taylor when the assumption behind it turns out wrong. That is the column that
decides, not "advantage."

---

## W-1 — Implementation

Recovers the one-time cost in `COST_TO_SERVE_MODEL.md` §5.

**Inputs needed:** loaded labor rate (`CD-01`); migration record volume from
`C1-DATA-01`; rehearsal count (`CD-07`); stabilization length (`CD-08`);
training delivery hours from `C1-TRAINING-01`.

| Structure | Fits when | Trade-off |
|---|---|---|
| Fixed fee for a frozen scope | Scope is genuinely frozen and migration volume is known | Verenward absorbs every overrun; with `C1-SCOPE-01` open this is a bet on an unmeasured migration |
| Time and materials against the loaded rate | Scope or data quality is uncertain | Taylor carries unbounded exposure and has no ceiling to approve; usually unacceptable to a first customer |
| Fixed fee for a defined base, T&M beyond a named boundary | Base scope is clear but data quality is not | Only works if the boundary is objective — "additional rehearsals beyond N" is objective, "unexpected complexity" is not |
| Phased fixed fees, re-quoted at each phase gate | Later phases depend on earlier findings | Taylor cannot see total cost at signature; needs a stated not-to-exceed or it is T&M with extra steps |

**Also to settle:** payment milestones, and whether implementation is invoiced
before, during, or on acceptance of cutover.

**Open issues**

- Migration is the dominant and least known cost. Fixing its price before
  `C1-DATA-01` produces a record count and a data-quality assessment is pricing
  an unmeasured liability.
- Nothing defines "implementation complete." Without `CD-08`, a fixed fee has no
  end and a T&M engagement has no exit.

**Owner question W-1:** *Does implementation carry a fixed fee, and if so, what
is the objective boundary at which additional work becomes billable?*

---

## W-2 — Subscription

Recovers `annual_run_cost` from `COST_TO_SERVE_MODEL.md` — the line the founder
labor red line is aimed at.

**Inputs needed:** the full `monthly_floor`, which requires `CD-01`, `CD-02`,
`CD-03` (retention), `CD-04` (attribution rule), `CD-09` (contingency).

| Structure | Fits when | Trade-off |
|---|---|---|
| Per named user, per month | Users correlate with support load and value | Punishes adding office staff and read-only viewers; can push Taylor into shared logins, which breaks `C1-IDENTITY-01` and the audit trail |
| Per active field technician | Technicians drive the field workload | Undercounts office-heavy use of purchasing, inventory, and financials |
| Flat platform fee for the whole company | Scale is stable and simple to administer | All growth risk sits with Verenward; a doubling of volume raises cost and not revenue |
| Flat base plus metered overage above named thresholds | Volume is uncertain, as here | Only defensible if the meters are ones Taylor can see and predict; a surprise overage bill damages a first-customer relationship badly |
| Tiered bands by company size | Simplicity is worth precision | Band boundaries become arguments; still needs `CD-02` to place Taylor in a band |

**Also to settle:** term length, uplift at renewal, whether the price is fixed
for the initial term, and what happens if measured cost exceeds the floor.

**Open issues**

- A subscription level that only clears cost when founder labor is valued at $0
  is prohibited by the readiness red line. The worksheet cannot detect that
  violation; whoever sets the level must check it against §4 of the cost model
  explicitly.
- Shared-cost attribution (`CD-04`) changes the floor materially while Customer 1
  is the only customer, so the same structure yields a different level depending
  on an accounting choice nobody has made.
- Retention (`CD-03`) is a subscription cost driver *and* a contract term. If
  they are decided separately they will disagree.

**Owner question W-2:** *What is the subscription unit — named user, technician,
flat, or base-plus-metered — and does the initial-term level clear the cost
floor with founder labor priced at the `CD-01` rate?*

---

## W-3 — Support

Recovers the support labor lines in `COST_TO_SERVE_MODEL.md` §4.

**Inputs needed:** `CD-01`; the support model draft under `C1-SUPPORT-01`;
committed hours and response expectations (`CD-13`); on-call posture (`CD-06`);
the third-party IT boundary (`CD-12`).

| Structure | Fits when | Trade-off |
|---|---|---|
| Included in the subscription | Support volume is predictable and bounded | Every hour of unexpected support is pure margin loss, and there is no signal to Taylor that a ticket costs anything |
| Separate recurring support fee | Support is a distinct commitment with its own hours | Taylor may decline it, which leaves Verenward supporting an unsupported customer anyway in practice |
| Tiered plans (business-hours vs extended vs on-call) | Off-hours coverage is genuinely optional | Requires the severity model to already exist, or the tiers describe nothing enforceable |
| Included baseline plus billable hours beyond a monthly allowance | Volume is unknown, as here | The allowance meter must be countable and visible, or every month ends in a dispute about what counted |

**Also to settle:** whether third-party IT triage (`CD-12`) is billable when it
turns out not to be a platform issue, and whether unused allowance carries over.

**Open issues**

- Support cannot be priced before it is defined. `C1-SUPPORT-01` must produce
  severity definitions, hours, and the bug-vs-enhancement boundary (`CD-11`)
  first; pricing an undefined commitment prices an unbounded one.
- Off-hours availability has a cost in months when nothing breaks (`CD-06`).
  Structures that bill only consumed hours do not recover it.
- Field technicians hitting device, network, or connectivity problems will call
  Verenward regardless of whose fault it is. Whether that time is recovered
  depends entirely on `CD-12`.

**Owner question W-3:** *Is support bundled into the subscription or charged
separately, and what is the committed coverage window Verenward will contract
to?*

---

## W-4 — Founding-customer treatment

Not a discount line by default — a decision about what Verenward gives and what
it receives.

**Inputs needed:** the answers to W-1, W-2, and W-3, since a concession is
expressed against a stated price. A concession against no price is not a
concession, it is just an absence of a price.

| Structure | Fits when | Trade-off |
|---|---|---|
| No concession; standard terms | Verenward wants a clean market-rate reference | Ignores that Taylor is absorbing genuine first-customer risk, which is real consideration |
| Reduced level for a fixed initial term, then to standard | The concession is for early risk, not forever | The step-up must be in the signed agreement or it will be renegotiated from a position of incumbency |
| Concession in exchange for named non-cash consideration (reference, case study, roadmap input, tolerance for defect windows) | Verenward values the non-cash items | Non-cash consideration must be written as an obligation or it is a discount with a story attached |
| Locked rate for a long term | Taylor needs budget certainty | Locks in a level derived entirely from `UNKNOWN` costs; the longer the lock, the larger the bet |

**Open issues**

- Whether Taylor even wants founding-customer framing is unknown, and it carries
  an implication — "you are first, some things will break" — that must be stated
  honestly rather than only implied by a lower number.
- If the concession is permanent it becomes the price. There is no meaningful
  distinction between a permanent discount and a lower price, except that one is
  harder to explain to the second customer.

**Owner question W-4:** *Is there a founding-customer concession; what exactly
does Verenward receive in return; and on what date or event does it end?*

---

## W-5 — Change requests

Scope changes to agreed work — distinct from W-6, which is new work.

**Inputs needed:** the frozen Day-1 scope from `C1-SCOPE-01`, without which
nothing can be identified as a change.

| Structure | Fits when | Trade-off |
|---|---|---|
| Written change order, quoted and approved before work starts | Scope is documented and both sides can point at it | Slows small changes; needs a lightweight path or it gets bypassed informally, which is worse than not having it |
| Change allowance included in implementation, drawn down | Small changes are expected during rollout | The allowance becomes the target; it must have a stated unit or it will be counted differently by each side |
| All changes billable at the loaded rate | Simple and honest | Every conversation becomes a quote, which is corrosive during a first rollout |

**Open issues**

- Without a frozen scope there is no baseline, so nothing is provably a change.
  This worksheet is not answerable before `C1-SCOPE-01` closes.
- The change process and the bug-vs-enhancement boundary (`CD-11`) must use the
  same words. If a "defect" under support terms is a "change" under this line,
  the same ticket has two prices and the argument is guaranteed.

**Owner question W-5:** *Is there an included change allowance during
implementation, and what is the approval threshold above which a written,
priced change order is mandatory?*

---

## W-6 — Billable custom work

New capability requested after Day 1.

**Inputs needed:** `CD-01`; `CD-11`; a stated position on who owns what is built.

| Structure | Fits when | Trade-off |
|---|---|---|
| Time and materials at the loaded rate | Work is exploratory | No ceiling for Taylor to approve; needs a not-to-exceed per request |
| Fixed quote per request | The request is specified well enough to quote | Specification effort is itself unpaid work unless the quote is billable |
| Retained development capacity per month | Taylor wants a steady stream of improvements | Unused capacity is either wasted or rolled over, and roll-over accrues into a liability |

**Also to settle — this is the line where it actually bites:** if custom work is
built into the shared platform, who owns it, may Verenward offer it to other
customers, and does Taylor pay full cost for something that becomes a product
feature? That is a `CD-15`-adjacent ownership question and needs counsel, not
this lane.

**Open issues**

- Custom work funded by one customer but merged into a shared platform is the
  most common source of first-customer ownership disputes. It must be settled in
  the agreement, not at the moment of the first request.
- If the same effort is billable as custom work but free as a defect, the
  bug-vs-enhancement boundary (`CD-11`) is doing pricing work. It must be written
  by someone who understands that.

**Owner question W-6:** *For custom work funded by Taylor and merged into the
shared platform, who owns the result and may Verenward sell it to others — and
does that answer change what Taylor is charged?*

---

## What these worksheets deliberately do not do

- They do not name, recommend, or imply a price, rate, discount, or level.
- They do not choose a structure. Each ends in a question, by design.
- They do not treat founder labor as free anywhere, including in the
  founding-customer worksheet.
- They do not bind either party. Nothing here is an offer.

## Open issues

- All six worksheets are gated on `CD-01` and `CD-02`. Until those are answered
  the structural options can be discussed but not evaluated, because the
  trade-offs cannot be sized.
- W-5 additionally requires `C1-SCOPE-01` to close, and W-3 requires the
  `C1-SUPPORT-01` support model to exist.
- W-6's ownership question is a legal judgment. It is recorded, not answered.
