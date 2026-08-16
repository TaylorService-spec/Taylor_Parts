# The job itself — how the work is done, and what operators want

**Last researched:** 2026-08-16 · **By:** field-service-domain-researcher (round 1)

**Scope note:** no foodservice-equipment-specific dispatcher source was found. Everything below
is **HVAC / general commercial field service as the nearest proxy trade.** Treat it as industry
context, not as evidence about any specific company.

## 1. Dispatch — the planning horizon

**Industry practice is firm day / flexible week / soft month.** ServiceTrade ships exactly three
views: Day for *"hour-by-hour adjustments"*, Week for *"optimizing workloads over several days"*,
Month for utilisation planning
([ServiceTrade](https://servicetrade.com/resources/blog/simplified-smarter-scheduling-meet-servicetrades-new-dispatch-and-schedule-experience/)).
Jobber frames the core loop as *"each day's work"*
([Jobber](https://www.getjobber.com/academy/hvac/hvac-dispatching/)).

> **⚠ This does not override the Owner.** He states that dispatch at the prospect **sets work for
> the week**, from having worked there. First-hand knowledge of one company beats industry-general
> research about that company. The reconciliation: **build Week as a first-class view for
> commitment and balancing, with Day as the drill-in for execution** — which satisfies both.

**How assignments are decided:** route/proximity first, skill/certification second, account value
third. ServiceTitan describes the dispatcher's live mental model as *"Which job has the highest
priority? Who has a more urgent job? Which jobs could bring in more money? Which jobs need
specific technicians or equipment?"*
([ServiceTitan](https://www.servicetitan.com/blog/webinar-recap-maximize-dispatcher-efficiency)).

**Emergencies mid-day** are absorbed two ways: a priority override, and a **standby / "move-up"
list** of flexible jobs kept ready to bump or backfill. That list is the industry's real answer —
not re-optimisation maths.

**What the board must show at a glance:** customer contact and address · job details and tags ·
equipment age and notes · **colour-coded confirmation status** · technician availability and
skills · and a **map showing technician locations alongside nearby unscheduled work**, because
dispatchers are constantly slotting urgent work into existing routes.

## 2. Parts — tiered, not binary

**Tier 1 (every truck):** high-frequency moderate-cost parts, targeting **60–70% of first-time
fixes from van stock**. **Tier 2 (warehouse):** expensive or infrequent, same-day reachable.
**Tier 3:** ordered per job
([Rossware](https://blog.rossware.com/post/creating-a-truck-stock-strategy-that-balances-inventory-costs-and-service-speed)).

**Reorder trigger is par level**, executed as a **nightly restock** rather than waiting for a
truck to run dry ([fieldservicesoftware.io](https://fieldservicesoftware.io/glossary/bin-stock-van-inventory/)).

**Top failure modes, repeated across sources:**
1. **Inventory accuracy — named "the biggest pain point."** Techs forget to log parts used; counts drift.
2. **Overstocking** — one source puts idle van inventory at **$8,000–12,000 per vehicle**.
3. **Understocking** — first-time-fix drops, accounts erode.
4. **Shrinkage** — named explicitly, distinct from breakage.

**Benchmarks worth building against:** first-time-fix **75–80% standard, 85%+ best-in-class** ·
inventory turns 4–6/year · obsolete write-offs under 2%.

## 3. Vocabulary — use these words

**Work order** (dominant in commercial/facilities; *not* "ticket" — that is oil-and-gas/construction
field-ticket language) · **visit** / **service appointment** · **quote** or **estimate** ·
**PM agreement** / **PPM** / **"PM & Labor" agreement** · **breakdown call** or **emergency
service call** (~4hr commercial response standard) vs **PM visit** (24–72hr window) ·
**truck stock** / **van stock** / **bin stock** · **par level** · **dispatch board**.

## 4. Complaint themes

Direct Reddit access failed (see gaps); the below comes from vendor community forums and review
aggregators — weaker signal, but first-party complaint text.

1. **Complexity outstrips value.** *"The product is complicated, which means you need help
   regularly, but their product support is TERRIBLE."*
2. **Sold features that don't work as described** — one contractor was told auto-confirm was
   possible, then found *"they can't until the day before, which is way too late so a useless
   function"* ([ServiceTitan Community](https://community.servicetitan.com/t5/General/Very-Disappointed-with-Service-Titan/m-p/36261)).
3. **Scheduling tools that deadlock each other** — *"Can't use schedule assist bc schedule is too
   full even though jobs haven't been confirmed and can't use route optimization once someone has
   been confirmed."*
4. **Inventory accuracy**, vendor-independent — the recurring operational pain.

## 5. What they want and do not have — the most useful section

1. **Right tech to right job automatically, without wrecking route efficiency.** Every vendor is
   building toward this; the dispatcher is doing it in their head today.
2. **A live view of confirmed vs tentative**, so reshuffling doesn't disturb committed work.
3. **Parts availability visible at scheduling time**, not discovered on site.
4. **Automation layers that don't lock each other out** — a direct, named "why can't my software
   just…" gap.
5. **Support and onboarding proportional to complexity** — a UX bar, not a feature.
6. **Follow-on work capture from emergency calls** — one source claims *"if you don't document the
   emergency visit and follow up with a full inspection quote, you miss 30–40% of potential
   follow-on work"* ([OxMaint](https://oxmaint.com/industries/hvac/hvac-service-dispatch-response-time-standards-explained)).

## 6. What the industry itself teaches — CFESA

From the public [CFESA course catalog](https://cfesa.com/courses/): **Electric, Gas, Steam & Water**
is the foundational systems course every technician takes regardless of equipment type;
Refrigeration and Electric get standalone multi-day modules; equipment-specific tracks (fryers,
combi ovens) sit **on top of** that foundation. Certification requires a year of hands-on plus
tests in **electricity, gas, steam, refrigeration** — the four canonical competency axes.

**Most decision-relevant:** CFESA runs a single combined support-staff course titled
**"Dispatchers / Parts Inventory Mgmt."** The industry itself treats dispatch and parts as **one
discipline**, which is a strong argument to design them as one surface rather than two modules.

## 7. What this changes for us

- **Dispatch board: Week as first-class, Day as drill-in** — satisfies both the Owner's
  first-hand account and industry practice.
- **Show the assignment reasoning** — route first, skill second, account value third — since
  dispatchers manage that trade-off manually today.
- **Ship a standby / move-up list.** It is the real answer to a mid-day emergency.
- **Put parts visibility inside the dispatch surface.** CFESA training dispatch and parts as one
  role is the strongest signal in this report.
- **Track first-time-fix rate as a first-class metric** — 75–85% is the credible band, and the
  entire van-stock literature organises around it.
- **Par-level restock with a nightly cycle** as the reorder model.
- **Support breakdown → follow-up quote conversion** explicitly.
- **Use their nouns.** Work order, visit, PM agreement, breakdown call, truck stock, par level,
  dispatch board. Do not invent new ones.
- **Do not lead with a deep skills-matrix engine** — proximity dominates real assignment logic.

## 8. ASSUMPTIONS

- That foodservice-equipment dispatch mirrors HVAC/commercial dispatch closely enough to
  generalise. **No foodservice-specific dispatcher source was found.**
- That complaint and wishlist themes transfer from general FSM to foodservice equipment.
- That "PM & Labor" / "PPM" terminology, partly sourced from UK pages, transfers to US usage.

## 9. What could NOT be determined

- **Reddit and trade forums were not retrievable** — every targeted query, including
  `site:reddit.com`, returned job postings and marketing instead of threads. **This is the largest
  gap against the brief.**
- **YouTube transcripts and comments were not accessible** — screen-layout claims are inferred
  from vendor descriptions of their own UI, not independent observation.
- **No foodservice-specific complaint or wishlist source was located.**
- **CFESA syllabus content is member-gated** — only the public catalog shape was used.
- **Manufacturer service-school curricula** (Taylor, ice-machine OEMs) were not researched and
  would sharpen the canonical-workflow picture.
