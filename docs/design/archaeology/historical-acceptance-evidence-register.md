# Historical acceptance evidence register — SOURCE UNAVAILABLE

**Lane:** P3-ARCH. **Mode:** EVIDENCE_WRITE — documentation only; no runtime code, test, config or
schema was changed by this lane.

**Baseline:** `origin/main` **`33945090`** (`33945090d66d2287fe0cdc362c80ad6e4e311067`,
*"Merge pull request #1863 from TaylorService-spec/impl/p1b-employee-truck-crosswalk"*). Every
absence and presence claim below was measured at this commit, against the object database of this
clone. *Standing rule in this programme: a correct code reading from the wrong branch is still a
false statement about the product.* If you re-run these commands from a different head, re-read the
verdicts.

---

> ## SUPERSEDED IN PART — 2026-09-13, lane ARCH-RECOVER
>
> **Six of the twenty-five SOURCE_UNAVAILABLE rows are now RECOVERED.** Nineteen are not. Twenty-two
> delivery archives held in local custody at `/mnt/d/Taylor_Parts/Claude Design Docs/` — outside this
> repository, and outside every archaeology lane's authority to search — were read on 2026-09-13.
> Nine of the twenty-nine named files are recovered, byte-verified, and committed at
> `docs/design-history/recovered/`. Manifest: `docs/design-history/recovered/RECOVERY-MANIFEST.md`.
>
> **Nothing in this register has been deleted or rewritten.** Every original row, count and verdict
> stands as written, marked superseded where a later measurement changed it, with the reason given.
> The absence finding was **correct about the repository and incomplete about the world** — see §1.4.
> This register's own §8 listed external survival as UNPROVEN and recommended pursuing it (R10); the
> recovery executes that recommendation and is evidence the recommendation was right.
>
> **Classification of every recovered artifact:**
>
> **RECOVERED HISTORICAL DESIGN EVIDENCE.**
> **NOT:** current North Star · current implementation authority · permission to redesign ·
> **proof that current EOS still conforms.**
>
> Recovering a visual authority restores the ability to **audit** a historical acceptance. It does not
> re-open that acceptance, does not make the artifact a current target, and is **not** evidence that
> today's EOS matches it. **No conformance comparison has been run against any recovered artifact**
> (§8.1). Owner ruling G0-3 stands unchanged: a future Owner-accepted North Star still supersedes
> historic visual authority, recovered or not.
>
> Index of what changed: **§0.4**. Residual: **§3.8**.

---

## 0. The ruling this register executes

> Some previously accepted design artifacts cannot be found on any known branch. Classify them:
> **HISTORICAL ACCEPTANCE EVIDENCE — SOURCE UNAVAILABLE.** Preserve artifact names, acceptance
> records, screenshots, handoffs, derivative documentation. **Do NOT recreate them from memory and
> present them as original sources.** They do NOT block Atlas / Design P2. Future Owner-accepted
> North Stars supersede unavailable historic visual authority.
>
> — Owner ruling **G0-3**

### 0.1 The rule this document obeys, stated so it can be checked

Several artifacts below are described in detail by surviving prose. **Nothing in this register
reconstructs an artifact's content.** Where a surviving document describes a lost artifact, the
description is quoted and attributed to the *surviving document*, and is labelled **evidence about
the artifact**, never the artifact. A reader must not be able to mistake any line here for a
recovered source. Where the only honest answer is "the drawing is gone," that is the answer.

Corollary, for implementers: a quoted composition note is **not** visual authority. It cannot be
conformance-tested, it cannot settle a composition dispute, and it may not be cited as a North Star
source. It is provenance.

### 0.2 Classification vocabulary

| Class | Meaning | Atlas consequence |
|---|---|---|
| **SOURCE_UNAVAILABLE** | Present in **no** tree object in this repository's object database — no branch, no tag, no deleted path, no unreachable object. The artifact cannot be produced. | Does not block Atlas. Not an Atlas input. A future Owner-accepted North Star supersedes it. |
| **HISTORY_ONLY** | Not at baseline, but recoverable from a named commit or tag. **Not lost.** | **Is** an Atlas input. Retrieval command given. |
| **BRANCH_ONLY** | Exists on a named unmerged branch. **Not lost.** | **Is** an Atlas input. Retrieval command given. |
| **UNPROVEN** | Status could not be established. Blocker named. | Treat as unavailable until proven otherwise; do not assume loss. |
| **RECOVERED — HISTORICAL OWNER-ACCEPTED VISUAL AUTHORITY AVAILABLE** *(added 2026-09-13)* | Absent from this repository's object database, and **produced from custody outside it**. The artifact can now be read. Byte-verified by SHA-256 against its delivery archive. | Does not become an Atlas input or a current target by being recovered. It restores **auditability** of a past acceptance, nothing more. Any promotion to current authority is an Owner decision, not a consequence of recovery. |

### 0.3 Naming

Existing `NS2-*` / `North Star - *` artifact identities are preserved verbatim, including for
artifacts that no longer exist. **No North Star artifact is renamed because the internal process is
now called Atlas.** Atlas is an internal programme name and appears in this internal document only;
it must never appear on a customer-facing product surface.

### 0.4 Recovery index — 2026-09-13

Full provenance, per-file SHA-256 and the four-status separation (ORIGINAL ARTIFACT · RECOVERED COPY ·
HISTORICAL ACCEPTANCE STATUS · CURRENT AUTHORITY STATUS) are in
`docs/design-history/recovered/RECOVERY-MANIFEST.md`.

| Row(s) | Artifact(s) | New class | Recovered from |
|---|---|---|---|
| **3** | `North Star - Work Order.dc.html` | RECOVERED | `Scoping answers needed P1.zip` (also P1v2) |
| **4** | `Implementation Render - Work Order.html` | RECOVERED | `Scoping answers needed P1v2.zip` |
| **5** | `North Star - Account P1.dc.html` | RECOVERED | `Customer North Star P1v1.zip` |
| **6** | `Proposed - Work Order.dc.html` | RECOVERED | `Scoping answers needed P1.zip` (also P1v2) |
| **20** | `DESIGN-HANDOFF-PARTS-P1v2.md` | RECOVERED | `Parts North Star P1v2.zip` |
| **21** | frames `1a`, `1a-m`, `1b`, `1b-m` (4 files) | RECOVERED | `Parts North Star P1v2.zip` |
| **24** | the five `Before-After` filenames | artifacts still SOURCE_UNAVAILABLE; **UNPROVEN → PROVEN** | `pilot-menu.js` in the Scoping archives |
| **25** | `Current - *.dc.html` membership | artifacts still SOURCE_UNAVAILABLE; **UNPROVEN → PROVEN — six named files** | `pilot-menu.js` in the Scoping archives |
| 1, 2, 7–19 | 15 named artifacts | **unchanged** — names corroborated by the delivered index; **no file recovered** | — |
| 22, 23 | `parts-ux-redesign-blueprint.md`; four `audit-*.png` | **unchanged** — in no archive | — |

**Where the archive that settled §3.6 was hiding, and why that is the finding.** §3.6 and §8 named
`HTML Site Scoping answers needed.zip` as the only thing that could settle the `Current - *` count —
and §2.1 records `Scoping answers needed P1.zip` as part of the corpus never vendored here. That
archive does not contain the eleven comparison canvases. It contains
`design_handoff_work_order/pilot-menu.js`, a delivered navigation component whose `LINKS` table
**indexes the entire pilot corpus by filename.** It is a delivered manifest, not a reconstruction, and
it settles both UNPROVEN items in §8 while confirming the artifacts themselves are still gone.

**Three artifacts recovered here were never in this register**, because no lane had cause to look for
them — most consequentially the **My Dashboard P1v2** artboards and ten frames, behind a **CLOSED
Owner acceptance of 2026-09-03**. The repository held that family's handoff document, so the lanes
read the family as current; the handoff itself says at
`docs/north-star/my-dashboard/DESIGN-HANDOFF-MY-DASHBOARD-P1v2.md:605-607` that it *"does not stand in
for the visual comp"* and asks the Owner whether the artboard should be made repo-resident. So §5.2's
*"the only acceptance in the register that is CLOSED against unavailable authority"* is correct
**within this register's set** and incomplete as a statement about the programme. Recorded in
`RECOVERY-MANIFEST.md` §7 F3; the open Owner item is **not** closed by the recovery.

---

## 1. Method — the absence proof, and why it is stronger than a branch sweep

Absence was **not** inherited from the three sibling archaeology lanes. It was re-measured here by
three independent methods, the third of which is stronger than what the lane contract required.

**Method 1 — every path ever named in any commit reachable from any ref.**

```
git --no-pager log --all --name-only --pretty=format: | sed '/^$/d' | sort -u
```
→ **4,893** distinct paths across **1,849** refs (`git for-each-ref | wc -l`), over **5,137**
commits (`git rev-list --all | wc -l`). Of these, **32** paths end in `.dc.html`.

**Method 2 — the `.dc.html` census, added-only.**

```
git --no-pager log --all --diff-filter=A --name-only -- '*.dc.html'
```
→ the same **32** paths. `git ls-tree -r --name-only 33945090 | grep -c '\.dc\.html$'` → **32**.
**The set of design canvases that ever existed on any ref is exactly the set present at baseline.
No `.dc.html` has ever been deleted or renamed in this repository.**

The 32 that exist: 20 `North Star - Financials 01–20`, 3 Opportunity
(`Opportunity-North-Star-P1v1`, `P1v2`, `-List-P1v4`), 2 Lists (`Lists-North-Star-P1`, `P2`), 2
Equipment (`North Star - Equipment P1`, `P1v2`), and one each of
`North Star - Dispatch Board P1`, `North Star - Parts P1`, `North Star - Receiving P1`,
`North Star - Sales Agreement P1v2`, `North Star - Service Operations P1`.

**Method 3 — every filename in every tree object in the object database, reachable or not.**
This is the decisive sweep: it sees objects that no ref points at, which a `log --all` sweep cannot.

```
git cat-file --batch-all-objects --batch-check --unordered \
  | awk '$2=="tree"{print $1}' > trees.txt          # 24,191 tree objects
git cat-file --batch --unordered < trees.txt | strings -n 3 | sort -u > all_tree_entry_names.txt
```
→ **24,191** tree objects yielding **59,735** distinct entry-name strings.

*Method validation, because a bad sweep proves nothing.* Tree objects store entries as
`<mode> <name>\0<20-byte binary sha>`, so a name appears inside a longer string and must be matched
as a **substring**, not a whole line. Validated against known-present files before trusting a single
negative: `North Star - Parts P1.dc.html` → 3 hits, `North Star - Equipment P1v2.dc.html` → 1 hit,
`eos-north-star-sources.md` → 2 hits. An earlier whole-line (`grep -xF`) pass returned false
"absent" for all three known-present controls and was discarded. **A negative from this sweep is
therefore a real negative.**

The sweep separates cleanly: **25 named artifacts return zero hits** (SOURCE_UNAVAILABLE) and the
**3** artifacts the sibling lanes reported as recoverable **do** return hits and were then pinned to
exact SHAs, branches and tags (§4). That split is itself the evidence that the method discriminates.

### 1.4 What the method proved, and where its boundary was — added 2026-09-13

**The absence finding was correct about the repository and incomplete about the world.** Nothing in
§1 is withdrawn. The three sweeps were sound, the method validation was sound, and every negative was
a real negative *about this object database*. Re-measured on 2026-09-13: the nine recovered files are
still in **no** tree object on **any** ref. §1's claim was never falsified — it was never a claim
about custody outside git.

**Every lane was correctly scoped to git refs, and the archives were outside every lane's authority to
search.** That is the whole of the error, and it is a scoping error, not a measurement error. This
register said so itself, twice: §8 lists *"whether any lost artifact survives **outside** this
repository (Downloads folders, delivery zips, Owner decision-record attachments)"* as **UNPROVEN**,
notes the corpus had been recovered from a Downloads-folder zip **once before**, calls external
survival *"plausible and worth pursuing"*, and raises it as **R10**. §8's closing note insisted the
correct class was *"SOURCE UNAVAILABLE, not 'never existed' or 'destroyed.'"* **That restraint is why
this recovery reads as a completion of the register's own recommendation rather than a refutation of
it.** Had the register written "lost" or "destroyed," it would now be wrong.

**The lesson for future lanes, stated so it can be acted on:** a git-scoped absence proof is the
strongest claim available *inside* a repository and is not a claim about the world. When an artifact's
own provenance record says it arrived from outside the repository — as
`eos-north-star-sources.md:5-8` does — a git sweep cannot close the question, and the lane should say
so in its verdict and name the external custody to search. **R10 was the right recommendation and
should have been a blocker on the word "permanently," which appears in derived statements of this
lane's findings and was never justified by the method.**

---

## 2. Headline counts — and the corrections to the inherited numbers

The lane contract carried reported counts of **8 (service), ~6 (inventory), 20 (sales/finance)**,
"roughly 34." **Verified independently; every one of the three needed correcting**, and the
inherited total double-counts heavily because all three lanes enumerate the same shared pilot corpus.

| Source | Reported | Verified here | Correction |
|---|---|---|---|
| Service (P3-A1) | **8** | **10** | The §0.3 heading says 8 and the table has 8 rows, but the paragraph immediately below adds `EOS UX Pilot.dc.html` and `North Star - Subpage Expansion.dc.html` as "also absent." Both are genuinely absent. The table undercounts its own section by 2. |
| Inventory (P3-A2) | **~6** | **7 rows / 10 files** | The lane's own §0.5 says **7** ("4 Parts frames counted as one row"); expanded to individual files it is **10** (1 handoff + 4 frames + 1 blueprint + 4 PNGs). The "~6" passed to this lane matched neither. |
| Sales/finance (P3-A3) | **20** | **21 named + 1 open-ended class** | The lane's table has 13 rows, two of which bundle: one row holds 6 out-of-domain `Proposed - *` files, one holds 5 `Before-After` files, and one names `Current - *.dc.html` as an unenumerated glob. Named files total 21; the `Current - *` count is **UNPROVEN** (§3.6). "20" is a reasonable round number, not a count. |

**Verified register total: 30 rows, covering 34 individually-named files plus two artifact classes
of indeterminate membership.** Of these:

| Class | Rows | Files | Where |
|---|---|---|---|
| **SOURCE_UNAVAILABLE** | **25** | **29 named**, plus 2 classes whose members are not individually named | §3, artifacts 1–25 |
| **BRANCH_ONLY** | **3** | 3 | §4 |
| **HISTORY_ONLY** | **2** | 2 | §4 |
| **UNPROVEN** | — | the `Current - *` membership and the 5 `Before-After` filenames | §3.6, §8 |

Row arithmetic, so it can be checked: §3.1 (2) + §3.2 (3) + §3.3 (11) + §3.4 (3) + §3.5 (4) +
§3.6 (2) = **25** SOURCE_UNAVAILABLE rows; §4 contributes **5**. Named-file arithmetic: 2 + 3 + 11 +
3 + 10 (§3.5 expands to 1 handoff + 4 frames + 1 blueprint + 4 PNGs) + 0 (§3.6 names no individual
file) = **29**, plus §4's 5 = **34**.

**Why "roughly 34" overstated the loss.** The three lanes independently enumerated the *same*
pilot corpus from the *same* register (`docs/design/eos-north-star-sources.md:88-115`). Summing the
lanes double-counts `EOS UX Pilot.dc.html`, `North Star - Subpage Expansion.dc.html`,
`Proposed - Work Order.dc.html`, `Proposed - Dispatch Board.dc.html`,
`Proposed - Dispatch Map.html`, `Proposed - Technician Mobile.dc.html` and
`Subpages - Operations.dc.html` — each appears in two or three lane tables. The deduplicated
count of distinct lost design artifacts is **29 named files**, not 34; and three artifacts the
inherited framing implied were lost are **not lost at all** (§4).

### 2.0 Recovery delta — 2026-09-13

The counts above stand as the measurement of **absence from this repository**. After recovery:

| Measure | As registered (2026-09-12) | After recovery (2026-09-13) |
|---|---|---|
| SOURCE_UNAVAILABLE rows | **25** | **19** |
| RECOVERED rows | — | **6** |
| Named files SOURCE_UNAVAILABLE | **29** | **20** |
| Named files recovered | — | **9** |
| Artifact classes of indeterminate membership | **2** (§3.6) | **0 indeterminate — both now enumerated**; all 11 members still unavailable |
| Individually-named design artifacts still unavailable | 29 + 2 classes | **31** (20 previously named + 11 newly named) |
| BRANCH_ONLY / HISTORY_ONLY (§4) | **5** | **5 — unchanged** |

**Do not read "19 rows remain" as a small residue.** The recovered nine are concentrated in the
load-bearing rows precisely because those artifacts were delivered as *handoff packages*, which is
what the archives contain. The pilot corpus — §3.1, §3.3, §3.4, §3.6, twenty of the remaining files —
was delivered as the single `HTML Site Scoping answers needed.zip` that is **not** in this custody.
Of the **36 filenames** the recovered index enumerates, **34 remain unavailable.**

### 2.1 Provenance of the whole lost corpus — one zip, never vendored

All of §3.1–§3.6 came from a single delivery and the register says plainly why it is not here:

> `docs/design/eos-north-star-sources.md:5-8` — *"The North Star concepts were produced in a design
> session outside this repository and recovered from `HTML Site Scoping answers needed.zip`
> (2026-08-25 04:07)."*
>
> `docs/design/eos-north-star-sources.md:249-253` — *"The recovered package is **not** committed to
> this repository — it contains a full third-party design system and image assets, and the
> repository already carries a rule against committing bulk artifacts. The Design Grammar exists so
> that the direction survives without it. If the package is needed again it should be attached to
> the Owner decision record rather than vendored here."*

The register states the package held **27 HTML files** (`:237`). **This was a deliberate decision,
not an accident** — and it is the root cause of every SOURCE_UNAVAILABLE row below. The mitigation
chosen was the derivative grammar; §5.1 records that the mitigation does not hold.

---

## 3. SOURCE_UNAVAILABLE — the register

Verified absent by all three methods of §1. For each: the name exactly as cited, every citation at
baseline, the acceptance record, surviving derivative documentation, and what currently rests on it.

### 3.1 Programme reports — the design language itself

| # | Artifact (exact name as cited) | Cited at (`file:line`, baseline `33945090`) | Status (2026-09-13) |
|---|---|---|---|
| 1 | `EOS UX Pilot.dc.html` | `docs/design/eos-north-star-sources.md:94` | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 2 | `North Star - Subpage Expansion.dc.html` | `docs/design/eos-north-star-sources.md:95` | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |

**Acceptance record.** No individual acceptance. Both sit under the register's blanket status line
(`docs/design/eos-north-star-sources.md:3`): *"Status: **AUTHORITATIVE VISUAL/COMPOSITIONAL
SOURCE**, Owner-approved 2026-08-25."*

**Evidence about artifact 1** — `docs/design/eos-north-star-sources.md:94` describes it as the pilot
report that *"Audits five canonical surfaces, names the eight-pattern design language, scores each
page, and lists the governance findings that bound what design can achieve."* The five surfaces are
not enumerated at that line; the scoring rubric is not reproduced anywhere at baseline.

**Evidence about artifact 2** — `docs/design/eos-north-star-sources.md:95` describes it as testing
*"the language across ~46 destinations. Establishes the ten page archetypes, the AI continuity
model, four design-system adjustments found under stress, and the P0–P3 migration order."* The ~46
destinations are not enumerated; the four design-system adjustments are not listed.

**Derivative documentation.** `docs/design/eos-north-star-design-grammar.md` — §3 the eight
patterns, §6 page archetypes, §7 handheld model, §8 AI interaction model. **This is a derivative,
not the artifacts**, and see §5.1: it does not cite them.

**On the "only AI continuity model in the programme" claim.** Verified and **substantially
confirmed, with a correction to the wording.** `grep -rn "AI continuity" docs/` at baseline returns
exactly **one** hit — `eos-north-star-sources.md:95`, the citation itself. So the phrase names
nothing else in the repository. But the *content* is not wholly gone: `eos-north-star-design-grammar.md:180-196`
is a section headed **"8. AI interaction model `[NS]`"** carrying a seven-row surface/role table and
a stated pattern (*"observed fact → why it matters → consequence → one recommended governed action →
human acknowledgement → existing EOS authority executes"*). Whether that derivative is the whole of
the lost model or a summary of it **cannot be determined** — the derivative does not cite its source
(§5.1). **Recorded as: the model's earliest and fullest statement is unavailable; a derivative of
unknown completeness survives at a known location.** The sales lane's phrasing — that it "survives
nowhere else" — is too strong as written; §8 exists. The service lane's phrasing — that the grammar
is *"a derivative of them, not the artifacts"* — is exact and is the reading this register adopts.

**SUPERSEDED IN PART, 2026-09-13 — the five surfaces are now named.** Both artifacts remain
SOURCE_UNAVAILABLE; neither is in any archive. But this section noted of artifact 1 that *"the five
surfaces are not enumerated at that line."* The recovered `pilot-menu.js` index names them:
**Account, Opportunity, Sales Order, Work Order, Parts** (§0.4). The scoring rubric is **still not
recovered**, and §8's UNPROVEN item on whether the grammar's §8 is the whole AI continuity model
**stands unchanged** — both artifacts are still unreadable. Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms.

**Atlas consequence.** Do not block. Not an Atlas input. Atlas inherits the grammar as its stated
design language; it does **not** inherit an auditable trail back to the pilot evidence. Any Atlas
North Star that wants to *change* a pattern, archetype or the AI model may do so on its own
Owner-accepted authority and need not reconcile against these two artifacts, because no one can
reconcile against them. Record the change against the grammar section, not against the lost report.

### 3.2 Approved visual authorities that are missing — the load-bearing three

These are the sharpest findings in the lane. Each is an artifact an Owner acceptance **names as the
authority the work was accepted against**, and none can be produced. Full treatment in §5.

| # | Artifact | Cited at (`file:line`) | Status (2026-09-13) |
|---|---|---|---|
| 3 | `North Star - Work Order.dc.html` | `docs/DECISIONS.md:1957`; `docs/design/eos-north-star-sources.md:101,186,194`; `docs/design/north-star-migration-ledger.md:37`; `docs/architecture/SYSTEM_AUTHORITIES.md:19` | **RECOVERED — HISTORICAL OWNER-ACCEPTED VISUAL AUTHORITY AVAILABLE** (2026-09-13). Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms. §0.4 |
| 4 | `Implementation Render - Work Order.html` | `docs/DECISIONS.md:1957`; `docs/design/eos-north-star-sources.md:195`; `docs/design/north-star-migration-ledger.md:37`; `docs/architecture/SYSTEM_AUTHORITIES.md:19` | **RECOVERED — HISTORICAL OWNER-ACCEPTED VISUAL AUTHORITY AVAILABLE** (2026-09-13). Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms. §0.4 |
| 5 | `North Star - Account P1.dc.html` | `docs/DECISIONS.md:2168`; `docs/design/north-star-migration-ledger.md:130,175,180` | **RECOVERED — HISTORICAL OWNER-ACCEPTED VISUAL AUTHORITY AVAILABLE** (2026-09-13). Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms. §0.4 |

**SUPERSEDED 2026-09-13 — all three of the load-bearing three are RECOVERED.** *"These are the
sharpest findings in the lane … and none can be produced"* was true at baseline and is no longer true.
All three are now readable at `docs/design-history/recovered/` (§0.4). **§5 remains the correct
reading of the acceptances themselves** — recovery changes the *availability* of each authority, not
the *state* of any acceptance:

- Family 1 is **still closed** (2026-08-25), and its conformance is now auditable **in principle
  only** — nobody has run the audit (§8.1).
- The Account acceptance is **still `AWAITING_OWNER_VISUAL_ACCEPTANCE`**. Recovery does not close it.
- §5.5's flag that `DECISIONS.md:2168` cites `design_handoff_account/North Star - Account P1.dc.html`
  — *"a delivery-folder path, not a repository path"* — is **explained**: that is the exact internal
  path inside `Customer North Star P1v1.zip`. The citation was correct; it pointed into a delivery
  that was never vendored.

Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms.

### 3.3 The `Proposed - *` pilot corpus

| # | Artifact | Cited at | Surface it governed, per the surviving register | Status (2026-09-13) |
|---|---|---|---|---|
| 6 | `Proposed - Work Order.dc.html` | `eos-north-star-sources.md:101,189,196`; `DECISIONS.md:1958`; `SYSTEM_AUTHORITIES.md:19` | Work Order detail, Pilot 1. Superseded 2026-08-25 as visual truth; *"kept for history"* (`:196`) — the history it was kept for is unavailable. Its technician run-sheet concept is still named as reference for a later family. | **RECOVERED — HISTORICAL OWNER-ACCEPTED VISUAL AUTHORITY AVAILABLE** (2026-09-13). Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms. §0.4 |
| 7 | `Proposed - Sales Order.dc.html` | `eos-north-star-sources.md:102`; `DECISIONS.md:2030` | Sales Order detail, Pilot 2. **The register itself already declared this one lost** — see below. | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 8 | `Proposed - Account.dc.html` | `eos-north-star-sources.md:103` | Customer 360. *"Ceiling set by capability activation."* | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 9 | `Proposed - Account -Broadsheet-.dc.html` | `eos-north-star-sources.md:238` | The broadsheet styling experiment — the one file of 27 that linked the `_ds/broadsheet-…/` stylesheet. Exploratory; low loss, and the register says why Broadsheet is *not* the EOS language (`:237-245`). | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 10 | `Proposed - Opportunity.dc.html` | `eos-north-star-sources.md:104` | Opportunity detail. **Superseded 2026-08-26** by `Opportunity-North-Star-P1v2.dc.html`, which **is present** at `docs/north-star/opportunity/`. Low loss. | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 11 | `Proposed - Parts.dc.html` | `eos-north-star-sources.md:105` | Parts workspace — *"Persona-scoped queues."* | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 12 | `Proposed - Dispatch Board.dc.html` | `eos-north-star-sources.md:106` | Dispatch — *"Densest board; drag-scheduling with refusal reasons."* The present `North Star - Dispatch Board P1.dc.html` is the elevation of this; the base is unavailable. | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 13 | `Proposed - Dispatch Map.html` | `eos-north-star-sources.md:106` | The Dispatch map concept. Its design intent survives as the one clause quoted at `:106` and nothing more. | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 14 | `Proposed - Technician Mobile.dc.html` | `eos-north-star-sources.md:107` | Handheld, technician — *"Four moments of a field day."* **The four moments are not enumerated anywhere at baseline.** | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 15 | `Proposed - Warehouse Mobile.dc.html` | `eos-north-star-sources.md:108` | Handheld, warehouse — *"Pick / receive / count."* | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 16 | `Proposed - Equipment.dc.html` | `docs/north-star/equipment/DESIGN-HANDOFF-EQUIPMENT-P1v2.1.md:83`; `North Star - Equipment P1.dc.html:229`; `North Star - Equipment P1v2.dc.html:274` | The superseded Equipment concept. **Best-preserved lost artifact in the register** — see below. | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |

**Artifact 7 is a special case worth naming: the register recorded its own loss.**
`eos-north-star-sources.md:102` states *"**NEVER HANDED TO THIS REPOSITORY.** … If this artifact
exists, it has not been seen here."* Decision **#125** (`DECISIONS.md:2029-2031`) then built family 2
without it, explicitly: *"with **no Design artifact in hand**"*, and drew the correct consequence —
*"**Owner visual acceptance is load-bearing rather than confirmatory**"*, ledger state
`AWAITING_OWNER_VISUAL_ACCEPTANCE`. **This is the programme handling an unavailable source
correctly**, and it is the pattern the other rows in §5 did not follow. It is the precedent Atlas
should reuse.

**Artifact 16 — lost, but fully accounted for.** Frame **1e** of the present
`North Star - Equipment P1v2.dc.html` is titled *"Disposition — every block of
Proposed - Equipment.dc.html accounted for · ledger reconciled (P1v2)"* and carries a
block-by-block disposition table. Quoted as **evidence about the artifact**, from the surviving
frame — these are the *dispositions*, not the drawing:

| Block named in frame 1e as belonging to the lost artifact | Disposition recorded in frame 1e |
|---|---|
| Register table + status chips | → Customer Equipment tab in Lists grammar (1a) |
| "Register unit" button | → Add Equipment tab, account-scoped (1d) |
| Repairs 12mo · repair spend % of replace · "repair-heavy" flags | **Deferred — EQ-D1.** No governed analytics authority; not rendered |
| Warranty status | **Rendered — EQ-D2 closed.** `warrantyExpiresDate` is an existing governed fact |
| "Flag serial for OP-2026-00058" suggestion | **Deferred — EQ-D3.** No equipment→opportunity relationship exists; not invented for P1 |
| Received on PO · installed by WO lineage | → unified timeline's inventory half, honestly "not yet connected" (EQ-G3) |
| Compatible parts (14 →) | **Deferred — EQ-D4.** Separate Owner call |
| Received → Installed → In service stepper | → folded into status word + timeline; stored lifecycle is Active/Inactive/Retired |
| Move / reinstall · Retire actions | → kept as designed slots, honestly disabled with stated reason (1c, EQ-G4) |

`DESIGN-HANDOFF-EQUIPMENT-P1v2.1.md:82-84` adds the judgement: *"The prior
`Proposed - Equipment.dc.html` invented authority (repair economics, warranty, opportunity
flagging); every block is dispositioned in frame 1e — named, never silently kept or dropped."*
**Consequence: nothing actionable was lost with artifact 16.** Its every block is named and
dispositioned in a present, locked artifact, and its successor is present. This is the model for how
a superseded artifact should be retired, and it is the one row in §3 that needs no follow-up.

**SUPERSEDED IN PART, 2026-09-13.** Artifact 6 is **RECOVERED** — and the note that *"the history it
was kept for is unavailable"* no longer holds: `Proposed - Work Order.dc.html` and its successor
`North Star - Work Order.dc.html` were delivered in the same archive and are both readable, so the
supersession DECISIONS #123 records is now inspectable on both sides. Its technician run-sheet
concept, named as reference for a later family, is **readable again**. Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms.

**Artifacts 7–16 are unchanged: still SOURCE_UNAVAILABLE.** Every one of the ten is named in the
recovered `pilot-menu.js` index, which **independently corroborates that this register's names were
accurate** — they were transcribed from prose citations and now match a delivered manifest exactly.
Corroborating a name is not recovering a file. **Artifact 14 remains the highest-value gap** (§5.4):
the technician handheld still has no design artifact.

**Atlas consequence, §3.3.** None block Atlas; none is an Atlas input. For 6, 8, 11, 12, 13, 14, 15
the successor authority is either already present (12 → `North Star - Dispatch Board P1.dc.html`) or
is **Atlas's to produce** — and per the ruling a future Owner-accepted North Star supersedes the
unavailable historic authority outright, with no reconciliation owed. **Artifact 14 is the
highest-value gap**: the technician handheld has no recoverable design artifact at all (§5.4).

### 3.4 The `Subpages - *` corpus

| # | Artifact | Cited at | What the surviving register says it covered | Status (2026-09-13) |
|---|---|---|---|---|
| 17 | `Subpages - Commercial.dc.html` | `eos-north-star-sources.md:109` | *"Sales Agreement edit / accepted / states … Hardest commercial surface."* **Superseded 2026-08-26** for the *record* surface by `North Star - Sales Agreement P1v2.dc.html`, which **is present**. The register is explicit about the residue: *"Whatever else this artifact covers has not been seen here."* The **edit surface** and the state set beyond the record are unavailable. | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 18 | `Subpages - Operations.dc.html` | `eos-north-star-sources.md:110` | *"Receiving, scheduling, exception, balances — Cross-object consequence."* Cited by two lanes. The **balances** treatment is the earliest financial-surface design in the programme; the cross-object scheduling-consequence design has no successor. | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |
| 19 | `Subpages - Lists and States.dc.html` | `eos-north-star-sources.md:111` | *"142-row list + 12 honest states — The density floor and the state vocabulary."* `Lists-North-Star-P2.dc.html` (present) carries the extracted grammar; the **142-row density-floor specimen itself** is unavailable. | SOURCE_UNAVAILABLE — **unchanged.** Name independently corroborated 2026-09-13 (§0.4); no file recovered. |

**Unchanged 2026-09-13 — all three remain SOURCE_UNAVAILABLE.** All three are named in the recovered
index; none is in any archive. The **142-row density-floor specimen** (19) and the cross-object
scheduling-consequence design (18) are still unavailable, and §3.4's reading below stands in full.

**Atlas consequence.** None block Atlas. For 19, note precisely what is and is not lost: the *rule*
survives in Lists P2 and in `eos-north-star-design-grammar.md` §5 honest-state model; the
*specimen* that demonstrated the density floor at 142 rows does not. An Atlas density decision
therefore has a stated rule but **no worked reference example**, and must set its own.

### 3.5 Parts P1v2 — the shipped-workspace acceptance authority

| # | Artifact | Cited at | Status |
|---|---|---|---|
| 20 | `DESIGN-HANDOFF-PARTS-P1v2.md` | `docs/north-star/parts/IMPLEMENTATION-DELTA-PARTS-P1v2.md:34` — named **"Design authority"** | ~~SOURCE_UNAVAILABLE~~ → **RECOVERED — HISTORICAL OWNER-ACCEPTED VISUAL AUTHORITY AVAILABLE** (2026-09-13). Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms. §0.4 |
| 21 | Frames `1a`, `1a-m`, `1b`, `1b-m` (4 files) | `IMPLEMENTATION-DELTA-PARTS-P1v2.md:35` — named **"Acceptance authority"** | ~~SOURCE_UNAVAILABLE~~ → **RECOVERED — HISTORICAL OWNER-ACCEPTED VISUAL AUTHORITY AVAILABLE** (2026-09-13). Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms. §0.4 |
| 22 | `parts-ux-redesign-blueprint.md` | `docs/ai/memory-archive/project_parts_ux_redesign.md:21` | SOURCE_UNAVAILABLE |
| 23 | `audit-workspace-1440.png`, `audit-workspace-375.png`, `audit-record-1440.png`, `audit-record-375.png` (4 files) | `docs/north-star/parts/DESIGN-BRIEF-PARTS-P1v2.md:31-34` | SOURCE_UNAVAILABLE — **but reproducible; see below** |

Artifacts 20 and 21 are load-bearing; full treatment in §5.3.

**SUPERSEDED 2026-09-13 — rows 20 and 21 are RECOVERED; rows 22 and 23 are not.** The design authority
and all four acceptance-authority frames were recovered from `Parts North Star P1v2.zip`, at their
delivered filenames `1a-workspace-1440.png`, `1a-m-workspace-375.png`, `1b-record-1440.png`,
`1b-m-record-375.png`. §5.3's *"no fallback exists"* no longer holds.

**What has not changed, and it matters for this row specifically.** The Parts surface **shipped**, and
it has changed since the deployed `9848ec9d` the acceptance was measured against. The recovered frames
show the **accepted** state, not the current one. A mismatch found today would not distinguish drift
from an intended later change, because **row 23 — the four `audit-*.png` deployed-state captures — is
still SOURCE_UNAVAILABLE**, and it was the historic baseline. §3.5's REGENERABLE caveat stands
verbatim: a fresh capture serves Atlas and **cannot** re-audit the 2026-08-31 acceptance. Row 22,
`parts-ux-redesign-blueprint.md`, is in no archive and is **unchanged**. Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms.

**Artifact 22 — the surviving abstract is substantial.** `docs/ai/memory-archive/project_parts_ux_redesign.md`
preserves the Wave-6 package's headline finding, its recommendations and its outcome
(*"Implemented — PR #992 MERGED, main `1ab67d15` (2026-08-15)"*). What the archive does **not**
preserve is the body of §14d (manufacturer read authority), §14e (Action Center attention-item
model) and §14g (queue dedup analysis) — the inventory lane names these three as the substance. The
archive's one-line description of the package is at `:21`. **Recorded as: the analysis is
unavailable; its conclusions and its shipped outcome are preserved.**

**Artifact 23 — the only lost artifact in this register that can be regenerated.** These were
deployed-state captures, not design work. `DESIGN-BRIEF-PARTS-P1v2.md:24` records they were
*"Captured from the deployed build at `9848ec9d`"*, and `:38-40` gives the regeneration command:

```
node field-ops-app-vite/.claude/skills/run-field-ops-app-vite/partsNorthStarQuickGate.mjs --expect <live-sha>
```

**Caveat that must travel with that command:** it captures the surface as it is **now**, not as it
was at `9848ec9d`. It can produce a *current* audit set; it cannot reproduce the *historic* evidence
the P1v2 brief was built on, because the surface has changed since. **For Atlas that is sufficient**
— a fresh baseline capture is what an Atlas pass needs anyway. For re-auditing the 2026-08-31
acceptance it is **not** sufficient. Classified SOURCE_UNAVAILABLE for the historic set,
**REGENERABLE** for the purpose Atlas has.

### 3.6 Comparison and current-state corpus

| # | Artifact class | Cited at | Status |
|---|---|---|---|
| 24 | `1–5 * Before-After.dc.html` (**5** files; individual names never recorded) | `eos-north-star-sources.md:228` | SOURCE_UNAVAILABLE (class). Individual filenames **UNPROVEN** — no document at baseline enumerates them. **AMENDED 2026-09-13: the class is unchanged and no file was recovered; the filenames are now PROVEN** from a delivered index held outside the repository — all five named below. |
| 25 | `Current - *.dc.html` (count **UNPROVEN**) | `eos-north-star-sources.md:229` | SOURCE_UNAVAILABLE — **unchanged, no file recovered.** ~~count **UNPROVEN**~~ → **PROVEN 2026-09-13: six files**, all named below |

**SUPERSEDED IN PART, 2026-09-13 — the enumeration is settled; the eleven files are still gone.**
The blocker named below was *"the only document that could settle the count is the delivered package
`HTML Site Scoping answers needed.zip` … Unless that zip is produced from outside the repository, this
count cannot be established."* **The reasoning was right and the named document was not the only one.**
`Scoping answers needed P1.zip` — from the same delivery day, 2026-08-25, and recovered into local
custody — contains `design_handoff_work_order/pilot-menu.js`, whose `LINKS` table indexes the entire
pilot corpus by filename. A delivered manifest, not a reconstruction.

**Row 24 — the five filenames, UNPROVEN → PROVEN:**

1. `1 - Account Before-After.dc.html`
2. `2 - Opportunity Before-After.dc.html`
3. `3 - Sales Order Before-After.dc.html`
4. `4 - Work Order Before-After.dc.html`
5. `5 - Parts Before-After.dc.html`

**Row 25 — the membership, UNPROVEN → PROVEN. It is six, not "roughly four":**

1. `Current - Account Detail.dc.html`
2. `Current - Opportunities.dc.html`
3. `Current - Sales Order.dc.html`
4. `Current - Work Order.dc.html`
5. `Current - Parts List.dc.html`
6. `Current - Part Detail.dc.html`

**A correction this forces, recorded rather than buried.** The residue arithmetic below inferred
*"roughly **4** unnamed files"* from the 27-HTML-file total at `:237`. The count is **6**, and the
recovered index enumerates **36** distinct filenames in total. So either `:237`'s "27 HTML files" is
wrong, or the delivered package was a subset of what the menu linked. **This register's instruction
"do not publish a number" was the correct call on the evidence it had**; the number is now 6, on
delivered evidence. The 27-file total is moved to **UNPROVEN** (§8).

**What is still lost here, unchanged and stated plainly.** **Not one of the eleven files was
recovered**, and no scoring rubric was recovered. The **severity-graded audit of the then-current
Customers, Sales Order and Account surfaces** — this section's central loss — is **still gone.** We
now know exactly what to look for and exactly what is missing. Recommendation **R9** stands in full.
Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms.

**Evidence about the class**, from `eos-north-star-sources.md:227-230`: *"`1–5 * Before-After.dc.html`
pair each current surface with its proposal plus a severity-graded audit. `Current - *.dc.html` are
recreations of the production surfaces at the time of the audit (Barlow Condensed + Inter, no inline
palette — they reference real stylesheets)."*

**Why the `Current - *` count is UNPROVEN, and the blocker.** The register states the package held
**27** HTML files (`:237`) but names only ~23 individually. Arithmetic on the register's own
enumeration leaves a residue of roughly **4** unnamed files, which would be the `Current - *` set —
but the register never lists them, the residue depends on how the bundled rows are expanded, and
**no artifact at baseline enumerates them**. **Blocker:** the only document that could settle the
count is the delivered package `HTML Site Scoping answers needed.zip` (2026-08-25 04:07), which was
deliberately never vendored (`:249-253`). Unless that zip is produced from outside the repository,
this count cannot be established. **Do not publish a number for it.**

**What is lost here, stated once and plainly:** the **severity-graded audit of the then-current
Customers, Sales Order and Account surfaces**. Per the sales lane this was the only document that
scored what existed against what was proposed. **No successor exists at baseline.**

**Atlas consequence.** Does not block Atlas, and the loss is largely moot: these captured production
surfaces **as they were in 2026-08**, and the surfaces have since been migrated. A current-state
audit for Atlas must be freshly captured regardless. The methodological loss — that nobody
re-established a *severity-graded scoring rubric* — is real and is recorded in §6 as a recommendation,
not as a blocker.

---

## 3.7 Surviving screenshots and raster evidence — the whole picture, measured

The ruling requires preserving *"any surviving screenshots/PNGs in the repo."* Measured at baseline,
repository-wide:

```
git --no-pager ls-tree -r --name-only 33945090 | grep -icE '\.(png|jpg|jpeg|webp|gif)$'
```
→ **50**. And:

```
git --no-pager ls-tree -r --name-only 33945090 -- docs/ | grep -iE '\.(png|jpg|jpeg|webp)$' \
  | grep -vc 'financials/frames/'
```
→ **0**.

**The entire repository contains exactly 50 raster images, and all 50 are
`docs/north-star/financials/frames/*.png`** — the 20-page Financials North Star frame set at 1440 and
375 (`01-overview-1440.png` … `20-governance-375.png`, plus per-record variants such as
`02-billing-queue-item-1440.png`, `03-invoice-record-1440.png`, `05-payment-record-1440.png`,
`12-budget-revise-1440.png`, `13-goal-create-1440.png`, `15-employee-performance-375-self.png`).

**Two consequences, both worth stating.**

1. **Financials is the only family in the programme with raster acceptance evidence.** Its 20
   `.dc.html` canvases *and* 50 frame PNGs are all present. It is the best-preserved family in the
   repository and needs nothing from this register.
2. **No other family has a single surviving screenshot.** There is no raster evidence anywhere for
   Work Order, Account, Parts, Dispatch, Equipment, Service Operations, Receiving, Opportunity, Sales
   Agreement or Lists. So for every §3 artifact, **there is no screenshot fallback** — the four Parts
   audit PNGs of §3.5 #23 are absent, and nothing else was ever committed in their place. Where this
   register says a composition cannot be re-read, that is final: no image of it survives either.

**Lane disagreement recorded.** The sales lane (§1.1) counts *"44 acceptance PNGs"* in the current
tree. **The measured count at baseline `33945090` is 50**, all in
`docs/north-star/financials/frames/`. Both readings are recorded as the contract requires; this
register uses **50**, and the command above is reproducible. The likely cause of the gap is that 44
counts the twenty pages' primary 1440/375 pairs and misses the six per-record and per-state variants,
but that reconstruction is inference and is not asserted as fact.

---

## 3.8 The residual after recovery — what is still genuinely unavailable (2026-09-13)

**This recovery does not resolve §3.** Nineteen of twenty-five rows stand. Listing them together so no
reader can mistake a partial recovery for a closed one.

| # | Still unavailable | Row | Note |
|---|---|---|---|
| 1 | `EOS UX Pilot.dc.html` | §3.1 r1 | name + its five audited surfaces now known; **no file** |
| 2 | `North Star - Subpage Expansion.dc.html` | §3.1 r2 | name corroborated; **no file** |
| 3 | `Proposed - Sales Order.dc.html` | §3.3 r7 | the register already recorded its own loss; unchanged |
| 4 | `Proposed - Account.dc.html` | §3.3 r8 | |
| 5 | `Proposed - Account -Broadsheet-.dc.html` | §3.3 r9 | exploratory; low loss |
| 6 | `Proposed - Opportunity.dc.html` | §3.3 r10 | successor present; low loss |
| 7 | `Proposed - Parts.dc.html` | §3.3 r11 | |
| 8 | `Proposed - Dispatch Board.dc.html` | §3.3 r12 | successor present |
| 9 | `Proposed - Dispatch Map.html` | §3.3 r13 | design intent survives as one quoted clause |
| 10 | `Proposed - Technician Mobile.dc.html` | §3.3 r14 | **highest-value gap.** The handheld still has no design artifact; the "four moments" are still unenumerated |
| 11 | `Proposed - Warehouse Mobile.dc.html` | §3.3 r15 | |
| 12 | `Proposed - Equipment.dc.html` | §3.3 r16 | fully dispositioned in a present frame; needs no follow-up |
| 13 | `Subpages - Commercial.dc.html` | §3.4 r17 | the edit surface and state set remain unavailable |
| 14 | `Subpages - Operations.dc.html` | §3.4 r18 | no successor for the cross-object scheduling consequence |
| 15 | `Subpages - Lists and States.dc.html` | §3.4 r19 | the 142-row density specimen |
| 16 | `parts-ux-redesign-blueprint.md` | §3.5 r22 | in no archive |
| 17 | `audit-workspace-1440.png`, `audit-workspace-375.png`, `audit-record-1440.png`, `audit-record-375.png` | §3.5 r23 | 4 files. REGENERABLE for Atlas; **not** for re-auditing 2026-08-31 |
| 18 | `1 - Account Before-After.dc.html` … `5 - Parts Before-After.dc.html` | §3.6 r24 | 5 files, **now named** |
| 19 | `Current - Account Detail.dc.html`, `… Opportunities`, `… Sales Order`, `… Work Order`, `… Parts List`, `… Part Detail` | §3.6 r25 | 6 files, **now named and counted** |

**Arithmetic, so it can be checked.** 29 named SOURCE_UNAVAILABLE files − 9 recovered = **20 still
unavailable under their original names**; plus **11 newly named** members of rows 24–25 = **31
individual design artifacts still genuinely unavailable.** Of the **36 filenames** the recovered index
enumerates, **34 remain unavailable.** §4's five BRANCH_ONLY / HISTORY_ONLY artifacts are unaffected.

**The one custody searched is not the only custody.** `HTML Site Scoping answers needed.zip` — the
source of §3.1, §3.3, §3.4 and §3.6, and of twenty of the thirty-one remaining files — is **not** in
`/mnt/d/Taylor_Parts/Claude Design Docs/`. **R10 is not discharged.** It is now partially executed
with a demonstrated method and a demonstrated yield.

---

## 4. NOT LOST — artifacts the inherited framing implied were unavailable

**These five must not be filed as lost.** Each is retrievable today with the command given. Three
were flagged by sibling lanes; two are corrections this lane produced.

| Artifact | Class | Ref / SHA (verified at baseline) | Retrieval |
|---|---|---|---|
| `docs/design/receiving-north-star-composition-map.md` | **BRANCH_ONLY** | branch `claude/receiving-p1-reconciliation`, single commit **`cd885d6bc419d41b64d617e78f839560c9d57fa0`** (2026-08-31). `git merge-base --is-ancestor cd885d6b 33945090` → **NO** | `git show cd885d6b:docs/design/receiving-north-star-composition-map.md` |
| `docs/design/card-composition-recovery-audit.md` | **BRANCH_ONLY** | branches **`docs/card-composition-audit`** and **`remotes/origin/docs/card-composition-audit`**, commit **`37af5dd250b9381acd92646595b9b8fd27033b63`** (2026-08-14), *"docs(design): site-wide card & composition recovery — repository-wide audit (read-only)"*. Not an ancestor of baseline | `git show 37af5dd2:docs/design/card-composition-recovery-audit.md` |
| `docs/implementation-plans/cycle-count-multi-part-and-scheduling.md` | **HISTORY_ONLY** | tag **`archive/cycle-count-a1-spec-f585125d`**; also branches `claude/cycle-count-a1-spec` and `remotes/origin/claude/cycle-count-a1-spec`, commit **`7e457d7feb44207912356f41878af26c91518abe`** (2026-09-01). Not an ancestor of baseline | `git show 7e457d7f:docs/implementation-plans/cycle-count-multi-part-and-scheduling.md` |
| `docs/assessments/wo-parts-planning-assessment.md` | **BRANCH_ONLY** | branches **`docs/wo-parts-planning-assessment`** and **`remotes/origin/docs/wo-parts-planning-assessment`**, commit **`1babc1c6`** (2026-08-06). Not an ancestor of baseline | `git show 1babc1c6:docs/assessments/wo-parts-planning-assessment.md` |
| `docs/epics/INVENTORY-CAPABILITY-EXPANSION-PLAN.md` | **HISTORY_ONLY** (renamed, not lost) | deleted at **`16103f1f`** (2026-07-07), *"Establish docs/capabilities/ as the Capability Plans documentation layer"* | Successor **present at baseline**: `docs/capabilities/InventoryManagementPlan.md` (verified with `git cat-file -e 33945090:…`). Pre-rename content: `git show 16103f1f^:docs/epics/INVENTORY-CAPABILITY-EXPANSION-PLAN.md` |

### 4.1 Two corrections to sibling-lane readings

**Correction 1 — `card-composition-recovery-audit.md` now has a branch name.** The sales lane
(§1.3) identified commit `37af5dd2` but named no branch, which left the artifact
practically unretrievable. It lives on **`docs/card-composition-audit`**, and the branch exists
**on `origin`**, so it is retrievable by anyone with the remote — not just from this clone. This
matters: it is a *site-wide* card/composition audit, therefore relevant to every domain's Atlas
pass, and it was one command away from being filed as lost.

**Correction 2 — `wo-parts-planning-assessment.md` was never removed.** The inventory lane (§0.3)
records it as *"Added `1babc1c6` (2026-08-06), later removed."* **There is no deletion commit.**
`git log --all --diff-filter=D -- docs/assessments/wo-parts-planning-assessment.md` returns empty,
and `git branch -a --contains 1babc1c6` returns `docs/wo-parts-planning-assessment` and its
`origin` counterpart. It was **never merged**, not removed — BRANCH_ONLY, not deleted. The
practical difference: "removed" implies a decision to drop it; "never merged" implies unfinished
work that may still be wanted.

### 4.2 Atlas consequence for §4

**All five are available Atlas inputs**, retrievable with the commands above.
`card-composition-recovery-audit.md` is site-wide and should be read by every Atlas domain pass.
`receiving-north-star-composition-map.md` is the Receiving reconciliation and belongs to the
Receiving/inventory pass. Neither is on the integrated head, so **neither is visible to a reader who
only looks at `main`** — which is precisely how both came to be reported as missing. Recommend the
controller decide whether to merge or explicitly archive them (§6).

---

## 5. LOAD-BEARING — Owner acceptances with no retrievable basis

**This is the register's most valuable output.** Each subsection names a sign-off whose stated
authority cannot be produced. Each claim in the lane contract was checked; one needed qualifying.

### 5.0 Summary — which acceptances are affected

| Acceptance | Date | Stated authority | Authority status | Verdict |
|---|---|---|---|---|
| **Family 1 — Work Order**, `Acceptance: Closed 2026-08-25` | 2026-08-25 | `North Star - Work Order.dc.html` + `Implementation Render - Work Order.html` | both SOURCE_UNAVAILABLE | **AFFECTED — closed, unreproducible.** The most serious row. |
| **DECISIONS #123** — Work Order visual source ruling | 2026-08-25 | same two artifacts | both SOURCE_UNAVAILABLE | **AFFECTED.** A standing Tier-1 authority entry pointing at nothing. |
| **Parts P1v2** — seven Owner rulings, *"design direction APPROVED"* | 2026-08-31 | `DESIGN-HANDOFF-PARTS-P1v2.md` + frames `1a`,`1a-m`,`1b`,`1b-m` | all SOURCE_UNAVAILABLE | **AFFECTED — shipped surface.** |
| **DECISIONS #128** — Account reconciled against approved design | 2026-08-26 | `North Star - Account P1.dc.html` | SOURCE_UNAVAILABLE | **AFFECTED, but acceptance never closed** — ledger reads `AWAITING_OWNER_VISUAL_ACCEPTANCE`. Materially lighter. |
| **Design Grammar** — *"TRANSLATION CONTRACT, Owner-approved 2026-08-25"* | 2026-08-25 | the whole recovered corpus, via the register | corpus SOURCE_UNAVAILABLE | **AFFECTED — widest blast radius.** See §5.1. |
| **DECISIONS #125** — Sales Order composed from the grammar | 2026-08-26 | *explicitly none* | n/a | **NOT AFFECTED.** Handled correctly at the time; the precedent to reuse. |

**SUPERSEDED IN PART, 2026-09-13 — the authorities are available; the acceptance states are not changed.**
Read the two columns separately: *authority status* changed for four rows, *verdict* changed for none.

| Acceptance | Authority status now | Acceptance state now | Still not established |
|---|---|---|---|
| **Family 1 — Work Order**, closed 2026-08-25 | **both RECOVERED** — `North Star - Work Order.dc.html` + `Implementation Render - Work Order.html` | **still Closed 2026-08-25.** Unchanged | **Whether the shipped surface conforms. Nobody has run the comparison** (§8.1) |
| **DECISIONS #123** — Work Order visual source ruling | **both RECOVERED** | still a standing Tier-1 authority | It no longer points at nothing. Whether the *implementation* matches it is unmeasured |
| **Parts P1v2** — seven Owner rulings, shipped | **handoff + all four frames RECOVERED** | still *"design direction APPROVED"* 2026-08-31 | Surface changed since `9848ec9d`; the historic `audit-*.png` baseline is **still unavailable** (§3.5 r23) |
| **DECISIONS #128** — Account | **RECOVERED** | **still `AWAITING_OWNER_VISUAL_ACCEPTANCE`.** Recovery does not close an acceptance | Conformance unmeasured; the acceptance is the Owner's to move |
| **Design Grammar** — translation contract | **unchanged.** `EOS UX Pilot.dc.html` and `North Star - Subpage Expansion.dc.html` are **still unavailable**; 34 of 36 pilot files remain gone | unchanged | §5.1 stands in full. **The widest-reach finding is not repaired by this recovery** |
| **DECISIONS #125** — Sales Order | n/a — `Proposed - Sales Order.dc.html` still unavailable. An `Implementation Render - Sales Order.html` was recovered (`RECOVERY-MANIFEST.md` §7 F4) | **NOT AFFECTED**, unchanged | Whether an implementation render carries any authority is an **Owner** question, not a documentary one |

**One addition to this table's scope, recorded in §0.4 and not corrected away.** *"The only acceptance
in the register that is CLOSED against unavailable authority"* is accurate for this register's set.
A **second** closed Owner acceptance — **My Dashboard P1v2, 2026-09-03** — also rested on visual
authority absent from the repository, and **no lane classified it**, because the family's handoff
document was present. Its artboards are now recovered. Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms.

### 5.1 The Design Grammar's evidencing chain is broken — the finding with the widest reach

This is the finding no sibling lane reports, and it is the one that matters most, because the grammar
is what every later family was built from.

`docs/design/eos-north-star-design-grammar.md:3-4` states:

> Status: **TRANSLATION CONTRACT**, Owner-approved 2026-08-25. Source-grounded — **every `[NS]`
> claim is evidenced in a recovered artifact listed in** [`eos-north-star-sources.md`].

and `:13-14`:

> The recovered `Proposed - *` artifacts hold visual and compositional authority.

**Measured at baseline:** the grammar carries **38** `[NS]`-labelled claims
(`grep -c '\[NS\]' docs/design/eos-north-star-design-grammar.md` → 38). `[NS]` is defined at `:8` as
*"extracted directly from a recovered North Star concept."* **Every artifact those 38 claims are
evidenced against is SOURCE_UNAVAILABLE** — all eleven `Proposed - *` (§3.3), all three
`Subpages - *` (§3.4), and both programme reports (§3.1).

**Two consequences, and they are different in kind.**

1. **The grammar is not falsifiable against its stated sources.** Its own status line offers a
   verification route — check any `[NS]` claim against the recovered artifact — and that route is
   closed. No one can confirm a claim is extraction rather than invention, and no one can detect
   drift if a later edit changed one.
2. **The grammar names no source per claim.** `grep -n -iE "derivative|derived from|Subpage
   Expansion|UX Pilot|pilot report"` over the grammar returns **zero hits**. It does not cite
   `EOS UX Pilot.dc.html` or `North Star - Subpage Expansion.dc.html` anywhere, even though §3, §6,
   §7 and §8 carry exactly the content `eos-north-star-sources.md:94-95` attributes to those two
   reports. **So even the mapping from claim to artifact is gone** — not merely the artifacts. If
   the corpus were recovered tomorrow, re-auditing the 38 claims would require re-deriving which
   artifact each came from.

**What this does NOT mean.** The grammar is not thereby wrong, and nothing here impugns it. It has
been implemented across multiple families, tested, and gate-passed; its content has been
independently exercised by working software. **It is unverifiable against its stated provenance, not
unsound.** The distinction is the whole point: this register classifies *evidence availability*, and
must not be read as a quality finding about the grammar.

**Atlas consequence — and it is a favourable one.** Per the ruling, a future Owner-accepted North
Star supersedes unavailable historic visual authority. The grammar's practical authority for Atlas
should rest on **its Owner approval of 2026-08-25 plus its demonstrated implementation record**, not
on the broken `[NS]` evidencing chain. **Recommend the grammar's status line be amended** to say so
plainly — that `[NS]` marks a claim extracted from a corpus now classified
HISTORICAL ACCEPTANCE EVIDENCE — SOURCE UNAVAILABLE, and that the label records origin, not a
verification route. That is a documentation change in another lane's scope; **not made here**
(this lane may write only under `docs/design/archaeology/`). Raised to the controller in §6.

### 5.2 Family 1 — Work Order: closed against two artifacts that do not exist

> **SUPERSEDED 2026-09-13 — both artifacts are RECOVERED.** The heading is kept as the record of what
> was believed and measured on 2026-09-12. `North Star - Work Order.dc.html` and
> `Implementation Render - Work Order.html` were both in `Scoping answers needed P1.zip` / `P1v2.zip`
> and are readable at `docs/design-history/recovered/Scoping/`. **This section's reasoning was right
> about everything except availability** — in particular its correction that the acceptance rests on
> **two** unavailable artifacts, not one, is why the recovery had to produce both, and did.
>
> **The acceptance is still Closed 2026-08-25, and no one has audited it.** Derived statements that
> visual conformance is *"permanently unauditable"* are **withdrawn** — the word "permanently" was
> never supported by a git-scoped method (§1.4). The accurate statement is: **conformance is now
> auditable and remains unaudited** (§8.1). Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms.

**Contract claim:** *"`North Star - Work Order.dc.html` (the approved Family-1 source work was closed
against on 2026-08-25)."* **VERIFIED, and it is worse than stated — the acceptance rests on two
unavailable artifacts, not one.**

The acceptance, `docs/design/north-star-migration-ledger.md:34-41`:

| Ledger row | Value |
|---|---|
| **Visual authority** | `North Star - Work Order.dc.html` + `Implementation Render - Work Order.html` (P1v2, Owner ruling 2026-08-25) |
| **Gate** | Full Sandbox Regression Gate, exit 0, all 8 ledger phases, 300/300 visits, 40/40 scanner, zero RAW_ID findings |
| **Acceptance** | **Closed 2026-08-25** |

The ledger's own rule, `:28`: *"**Acceptance** — the Owner's state. Only the Owner moves this
column."* **This is the only acceptance in the register that is CLOSED against unavailable
authority.** Every other affected row is either awaiting acceptance or is a direction approval.

**DECISIONS #123** (`docs/DECISIONS.md:1953-1958`) is the ruling behind it:

> **Date:** 2026-08-25 **Decision:** Owner ruling (P1v2). The approved visual source for the Work
> Order family is `North Star - Work Order.dc.html`, with `Implementation Render - Work Order.html`
> as the explicit pixel target. `Proposed - Work Order.dc.html` is superseded as visual truth.

And it is a **standing** authority, not just history — `docs/architecture/SYSTEM_AUTHORITIES.md:19`
carries it as a live row in the system-authorities table: *"**Work Order visual source (P1v2, Owner
2026-08-25)** — `North Star - Work Order.dc.html` is the approved visual source;
`Implementation Render - Work Order.html` is the pixel target … DECISIONS #123."*

**What rests on this today.** The `Implementation Render` was defined as *"the explicit **pixel
target** … What a running page is compared against"* (`eos-north-star-sources.md:195`). **There is
now nothing to compare a running page against.** Concretely: the family-1 conformance question
*"does `WorkOrderDetailPage.jsx` still match its approved visual source?"* is **permanently
unanswerable**. Note the gate evidence above is untouched by this — the Full Sandbox Regression Gate
result stands on its own; it is the *visual* conformance claim that has no basis.

**What survives, and it is more than for most rows.** The **rule** extracted from the artifact is
preserved verbatim in three places (`eos-north-star-sources.md:205`, `DECISIONS.md` #123,
`SYSTEM_AUTHORITIES.md:19`) and it is the programme's most-cited design law:

> **KEEP THE DESIGNED STRUCTURAL SLOT. RENDER A TRUTHFUL STATE IN IT. NEVER FABRICATE THE CONTENT.**

`eos-north-star-sources.md:198-234` preserves the surrounding discipline in detail — structure may
anticipate a capability, content may not; a slot may not be silently dropped; emphasis colour is
reserved; where no slot can be honest, omit and say so; an affordance may hold its place *disabled
and explicitly unavailable*, distinguishing *not yet, for anyone* from *not you*. It also preserves
the artifact's own masthead caveat — *"live truck-stock reads · WO naming service · notification
channel · suggestion engine. None exist today."* **All of this is evidence about the artifact and
its ruling. None of it is the composition, the hierarchy, the density, the geometry or the
typography** — which is exactly what `:194` required the implementation to *"materially reproduce."*
**That requirement can no longer be audited.**

**Atlas consequence.** Does not block Atlas. Family 1 is the strongest candidate for an early
Atlas North Star, because it is the one shipped family whose visual conformance cannot be checked
at all. A new Owner-accepted Work Order North Star supersedes both unavailable artifacts outright
and **restores an auditable pixel target** — which is a net gain, not a recovery cost. Nothing is
owed to `North Star - Work Order.dc.html` in that pass.

### 5.3 Parts P1v2 — a shipped, Owner-accepted surface whose acceptance authority is unavailable

> **SUPERSEDED 2026-09-13 — the design authority and all four acceptance frames are RECOVERED**, from
> `Parts North Star P1v2.zip`. Heading kept as the record of what was measured on 2026-09-12.
> Statements that *"no fallback exists"* are **withdrawn as to availability.**
>
> **Two things did not change.** The Owner ruling of 2026-08-31 stands as it was; recovery neither
> re-opens nor re-confirms it. And the shipped surface has changed since the deployed `9848ec9d` the
> acceptance was measured against, while the historic deployed-state captures (§3.5 row 23) are
> **still unavailable** — so a present-day mismatch against the frames would not distinguish drift
> from an intended change. **This is not evidence that the shipped Parts workspace conforms**
> (§8.1). Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms.

**Contract claim:** *"`DESIGN-HANDOFF-PARTS-P1v2.md` plus four frames (the visual authority the
shipped Parts workspace was Owner-accepted against)."* **VERIFIED exactly as stated.**

`docs/north-star/parts/IMPLEMENTATION-DELTA-PARTS-P1v2.md:33-37`:

| Row | Value |
|---|---|
| **Design authority** | `DESIGN-HANDOFF-PARTS-P1v2.md` + frames `1a`, `1a-m`, `1b`, `1b-m` |
| **Acceptance authority** | the four frames, per the handoff |
| **Current deployed** | `9848ec9d` — `platform-sandbox` / `sandbox` |

The acceptance, `IMPLEMENTATION-DELTA-PARTS-P1v2.md:20-22`:

> **Status: the Owner ruled on all seven items on 2026-08-31 — design direction APPROVED with
> authority corrections. §6 is now the implementation contract.**

**No fallback copy exists, and the delta says why.** `:27-30`: *"`Parts North Star P1v3.zip` is
**byte-identical to `Parts North Star P1v2.zip`** — the handoff, the `.dc.html`, and all four frames
compare `SAME`. P1v3 carries no change."* **So the one artifact that might have carried a duplicate
is confirmed to be the same missing thing.** Verified independently: no `North Star - Parts P1v2.dc.html`
exists on any ref — the only Parts canvas in the 32-file census is
`docs/north-star/parts/North Star - Parts P1.dc.html`, which is **P1, the composition that was
rejected on sight**, not the accepted P1v2.

**This is the register's sharpest operational finding: a surface is in production, Owner-accepted
2026-08-31 against four frames, and the accepting artifact is in no commit on any ref. The `.dc.html`
for the accepted composition does not exist either — only for its rejected predecessor.**

**What survives.** Substantially more than for family 1, and it is genuinely useful:
- `IMPLEMENTATION-DELTA-PARTS-P1v2.md` — the element-by-element delta against P1v2 plus the seven
  Owner rulings that became the implementation contract (§6 of that file).
- `docs/north-star/parts/DESIGN-BRIEF-PARTS-P1v2.md` — the brief written *for* Design after P1's
  composition was rejected. This records the **intent**.
- `docs/north-star/parts/DESIGN-HANDOFF-PARTS-P1.md` and `North Star - Parts P1.dc.html` — the
  **superseded** P1. Useful for lineage; **must not be mistaken for the accepted authority.**
- `docs/design/parts-north-star-composition-map.md` (Parts I–XI, 742 lines) — the reconciliation of
  canvas against repository.
- `docs/north-star/parts/README.md:3-5` — which usefully limits the claim: *"**These files are
  VISUAL ACCEPTANCE AUTHORITY for the Parts page family.** They are **not** runtime authority, data
  authority, workflow authority, or permission authority."*

**A second finding this lane produced: the Parts README still points readers at the REJECTED
composition.** `docs/north-star/parts/README.md` was never updated for P1v2. At baseline it lists
only two files (`:12-13`) and labels `North Star - Parts P1.dc.html` — the composition
`DESIGN-BRIEF-PARTS-P1v2.md` says was *rejected on sight* — as **"Current visual authority."** Its
provenance line (`:15-17`) still reads *"`Claude Design Docs/Parts North Star P1v1.zip` … received
2026-08-30"*, predating the 2026-08-31 P1v2 ruling entirely. So two present documents disagree about
what governs Parts visually:

| Document | Names as current visual authority | Status of that artifact |
|---|---|---|
| `docs/north-star/parts/README.md:12` | `North Star - Parts P1.dc.html` | **present** — but it is the rejected P1 composition |
| `docs/north-star/parts/IMPLEMENTATION-DELTA-PARTS-P1v2.md:34-35` | `DESIGN-HANDOFF-PARTS-P1v2.md` + frames `1a`,`1a-m`,`1b`,`1b-m` | **SOURCE_UNAVAILABLE** |

**This is the most actively misleading state in the register.** Every other unavailable artifact
leaves a reader with nothing; this one leaves a reader with the *wrong* artifact, present, readable,
and labelled authoritative. A reader who follows the README will conform a surface to a composition
the Owner rejected. Added to §6 as **R11**.

The delta also preserves specific frame content as **evidence about the artifact** — e.g. `:49-57`
records that frame **1b** drew, under a band headed *ACTIVITY · the work-order and receiving
ledger*, a row `Aug 28, 2:03 PM / Adjusted / Opening adjustment · D. Reyes / +6`, and that this was
**falsified** because `LedgerTransaction` (`src/domain/inventoryAnalyticsEngine.ts:17`) carries
neither the actor nor the description. **That is a quoted fragment inside a falsification argument.
It is not the frame, and four such fragments would not reconstitute one.**

**Atlas consequence.** Does not block Atlas. The shipped Parts surface stands on its implementation
contract (§6 of the delta), which **is** present and **is** the operative authority for behaviour.
What is unavailable is the *visual acceptance* basis. Per the ruling, a future Owner-accepted Parts
North Star supersedes it. Until then, treat the **delta's §6 rulings as the authority of record**
and **do not cite the four frames as though they could be inspected**. The README's own
"visual acceptance authority only" limit makes this a narrower problem than family 1's.

### 5.4 `Proposed - Technician Mobile.dc.html` — the handheld has no design artifact at all

Not in the contract's list, but this register flags it as load-bearing on equal footing, because
**it is the only surface in scope with no visual authority of any kind, past or present.**

The service lane states it plainly: *"the technician handheld has no recoverable design artifact at
all."* Verified: the artifact is SOURCE_UNAVAILABLE (§3.3 #14); no successor North Star exists in
the 32-file census; and the only surviving description is the six-word clause at
`eos-north-star-sources.md:107` — *"Handheld, technician | Four moments of a field day."* **The four
moments are not enumerated anywhere at baseline.** The service lane reports that its own §2.11
account of `/service/technician-workspace` is reconstructed from prose and that *"the 'four moments'
structure cannot be checked against anything"* — and marks it UNPROVEN, correctly.

Partial mitigation, recorded for accuracy: `eos-north-star-design-grammar.md:167-179` (§7 Handheld
model `[NS]`) is a surviving derivative of handheld rules in general, and
`docs/north-star/parts/North Star - Parts P1.dc.html` frame **1c** is a handheld study at 375 and
`North Star - Receiving P1.dc.html` frame **1f** at 390 — both present, both *other domains*. So
handheld *grammar* survives; the **technician** handheld composition does not.

**Atlas consequence.** Does not block Atlas, but this is the **largest greenfield opportunity** in
the register: an Atlas technician-handheld North Star supersedes nothing, contradicts nothing, and
owes no reconciliation, because there is no prior authority to reconcile with. Of every row here it
is the one where a new Owner-accepted North Star adds the most and costs the least.

### 5.5 `North Star - Account P1.dc.html` — affected, but the acceptance never closed

> **SUPERSEDED 2026-09-13 — RECOVERED**, from `Customer North Star P1v1.zip`, at the internal path
> `design_handoff_account/North Star - Account P1.dc.html`. **This section's sharpest observation is
> now explained rather than corrected:** it flagged that `DECISIONS.md:2168` cites a *"delivery-folder
> path, not a repository path."* That is the exact path inside the delivery archive. The citation was
> right; it pointed outside the repository, which is precisely the boundary §1.4 records.
>
> **The acceptance is still `AWAITING_OWNER_VISUAL_ACCEPTANCE`, in both ledger rows.** Recovery does
> not close an acceptance and does not move a column only the Owner may move. This section's judgement
> that the exposure is *"materially lighter"* than family 1's **stands unchanged.** Historical evidence only: **not** current North Star, **not** current implementation authority, **not** permission to redesign, **not** proof that current EOS conforms.

**Contract claim:** *"`North Star - Account P1.dc.html`."* **VERIFIED absent — and the acceptance
exposure is materially lighter than the contract's framing implies. Recorded because understating
this would be as wrong as overstating it.**

`docs/design/north-star-migration-ledger.md:174-176` and `:178-192`, family 3 second pass
(2026-08-26):

| Ledger row | Value |
|---|---|
| **Visual authority** | `North Star - Account P1.dc.html` — 1a desktop 1440, 1b tablet 768, 1c phone 375 |
| **Nature** | Presentation/composition reconciliation. Not a rebuild, not new product. |
| **Merged** | `7b6eaf14` (#1520), 2026-08-26, 16/16 checks green |
| **Acceptance** | **`AWAITING_OWNER_VISUAL_ACCEPTANCE`** |

**The acceptance state is `AWAITING_OWNER_VISUAL_ACCEPTANCE`, in both the first-pass row (`:135`)
and the second-pass row.** So **no closed Owner visual acceptance rests on this artifact** — unlike
family 1. What does rest on it is **DECISIONS #128** (`docs/DECISIONS.md:2160-2170`), a Tier-1
presentation decision:

> **#128 — The Account is reconciled against its approved design, not rebuilt; four Owner rulings
> close with it.** … #127 (PR #1511) migrated the Account … with **no Owner approved Account
> artifact in hand** … One now exists: `design_handoff_account/North Star - Account P1.dc.html`,
> supplied with a README that states plainly, *"#1511 was inspected as behavioral evidence only,
> never as visual truth."*

**Note the path.** The citation is `design_handoff_account/North Star - Account P1.dc.html` — a
**delivery-folder path, not a repository path**. Neither the folder nor the file is in any tree
object (§1, method 3). The artifact's own README, quoted inside #128, is also unavailable. Also
absent: the *"nine things called correct and eleven presentation adjustments"* comparison the
ledger attributes to the design (`:194-196`) — the eleven adjustments are summarised in the ledger,
the nine are not enumerated.

**What rests on it.** The reconciliation is unauditable: **A-D1–A-D4 were resolved and A-NS-1
recorded against an artifact no one can re-read**, and the ledger's own note says the comparison
happened *"in a session that could read it."* The 47-assertion
`test/accountNorthStarPage.test.jsx` encodes the *outcome* of that comparison, which is real
regression protection but is **not** the authority — a test cannot tell you the design intended
something it never asserted. Note also that family 3's Quick Gate certified `1c8095d3`, which
**predates** this pass; the ledger says so itself (`:190`) and marks a gate refresh owed. **That is
a separate open item, not an artifact-availability finding** — recorded so it is not conflated here.

**Atlas consequence.** Does not block Atlas, and the path forward is unusually clean: because
acceptance never closed, **the pending Owner visual acceptance for family 3 should simply be taken
against a future Atlas Account North Star rather than against the unavailable P1**. No sign-off has
to be reopened — one merely has to be directed at an artifact that exists.

---

## 6. Recommendations to the controller

Every item is documentation-only and **outside this lane's write scope**
(`docs/design/archaeology/` only). Nothing below was acted on here.

| # | Recommendation | Where it lands | Why |
|---|---|---|---|
| R1 | Amend `docs/design/eos-north-star-design-grammar.md:3-4` so the status line stops offering a verification route that is closed; state that `[NS]` records origin in a corpus now classified SOURCE_UNAVAILABLE, and that the grammar's authority rests on its 2026-08-25 Owner approval plus its implementation record. | design lane | §5.1 — widest blast radius; 38 claims. |
| R2 | Add a SOURCE_UNAVAILABLE marker to the register rows at `eos-north-star-sources.md:94-111,186-196` and to `docs/architecture/SYSTEM_AUTHORITIES.md:19`, pointing here. `SYSTEM_AUTHORITIES.md:19` is a **standing** authority row naming two unavailable artifacts with no hint that they cannot be read. | design / architecture lane | §5.2 — a reader today is sent to fetch a file that cannot be fetched. |
| R3 | Decide merge-or-archive for the two BRANCH_ONLY design documents — `card-composition-recovery-audit.md` (`docs/card-composition-audit`, site-wide, relevant to **every** Atlas pass) and `receiving-north-star-composition-map.md` (`claude/receiving-p1-reconciliation`). | controller | §4.1 — both were one command from being filed as lost; both invisible to a `main`-only reader. |
| R4 | Correct the inventory lane's §0.3 row for `wo-parts-planning-assessment.md` from *"later removed"* to **BRANCH_ONLY on `docs/wo-parts-planning-assessment`**. | P3-A2 / controller | §4.1 correction 2. |
| R5 | Correct the service lane's §0.3 count from **8** to **10** (its own prose adds two artifacts its table omits). | P3-A1 / controller | §2. |
| R6 | Prioritise Atlas North Stars for **Work Order** (§5.2, only closed acceptance with no auditable basis) and **Technician Mobile** (§5.4, no visual authority has ever existed). | Atlas planning | Highest ratio of restored auditability to cost. |
| R7 | Direct family 3's pending `AWAITING_OWNER_VISUAL_ACCEPTANCE` at a future Atlas Account North Star rather than at the unavailable P1. | Atlas planning / Owner | §5.5 — no sign-off needs reopening. |
| R8 | Adopt the **#125 pattern** as standing practice: when no artifact is in hand, say so in the decision and record Owner visual acceptance as *load-bearing rather than confirmatory*. | Atlas process | §3.3 — the programme already did this correctly once. |
| R9 | Re-establish a **severity-graded current-state audit rubric**. The only artifact that scored what exists against what is proposed was the lost `Before-After` / `Current - *` corpus (§3.6), and nothing replaced it. | Atlas process | §3.6 — a methodological gap, not a blocker. |
| R11 | Correct `docs/north-star/parts/README.md:12,15-17` — it labels the **rejected** `North Star - Parts P1.dc.html` as *"Current visual authority"* and its provenance predates the 2026-08-31 P1v2 ruling. Point it at the delta's §6 implementation contract and mark the P1v2 handoff + four frames SOURCE_UNAVAILABLE. | design / parts lane | §5.3 — the one place a reader is actively pointed at the wrong artifact rather than at none. |
| R10 | If `HTML Site Scoping answers needed.zip` (2026-08-25 04:07) or `Parts North Star P1v2.zip` can be produced from outside the repository, **attach them to the Owner decision record** per `eos-north-star-sources.md:249-253`. That is the only route that would reclassify §3 and settle the UNPROVEN count in §3.6. | Owner | The single highest-value recovery action available. |

---

## 7. Atlas consequence — the standing statement

Per Owner ruling **G0-3**, and applying to every row in §3:

1. **Nothing in §3 blocks Atlas or Design P2.** No Atlas work is gated on producing any
   SOURCE_UNAVAILABLE artifact.
2. **A future Owner-accepted North Star supersedes unavailable historic visual authority
   outright.** An Atlas pass owes no reconciliation against an artifact it cannot read, and must not
   be asked to reproduce a composition from prose.
3. **The five §4 artifacts ARE Atlas inputs** and must not be treated as lost. Retrieval commands
   are in §4.
4. **Derivative prose is provenance, not authority.** No quoted description in this register may be
   cited as a visual source, used as a conformance target, or presented as an original artifact.
5. **Where an artifact is superseded by a present successor, cite the successor** —
   `Proposed - Opportunity.dc.html` → `Opportunity-North-Star-P1v2.dc.html`;
   `Subpages - Commercial.dc.html` (record surface only) → `North Star - Sales Agreement P1v2.dc.html`;
   `Proposed - Dispatch Board.dc.html` → `North Star - Dispatch Board P1.dc.html`;
   `Proposed - Equipment.dc.html` → `North Star - Equipment P1v2.dc.html` (frame 1e dispositions
   every block — §3.3).
6. **`NS2-*` and `North Star - *` identities are unchanged.** No artifact was renamed for Atlas.

**Added 2026-09-13, after the recovery. G0-3 is unchanged; these are additions, not amendments.**

7. **Recovery does not create an Atlas input, and does not create a conformance target.** The nine
   recovered files are **RECOVERED HISTORICAL DESIGN EVIDENCE** — **not** current North Star, **not**
   current implementation authority, **not** permission to redesign, and **not proof that current EOS
   still conforms.** They live at `docs/design-history/recovered/`, deliberately **not** at
   `docs/north-star/`. Point 2 of this section is undisturbed: a future Owner-accepted North Star
   still supersedes historic visual authority, **recovered or not**, and an Atlas pass still owes no
   reconciliation against any of it.
8. **What recovery *does* change is auditability, for three acceptances, and nothing has been
   audited.** If the controller wants a conformance verdict on Family 1 Work Order, Parts P1v2 or the
   Account, that is **new work against a now-available yardstick**, and its result is unknown today.
   Do not let "the authority was recovered" travel as "the surface conforms."
9. **Promotion is an Owner decision.** Whether any recovered artifact — including the My Dashboard
   P1v2 artboards, whose handoff at `:605-607` asks exactly this question — becomes repo-resident
   current authority is the Owner's call. The recovery lane did not make it and must not be read as
   having made it.
10. **Two Financials canvases in `docs/north-star/financials/` are not the delivered bytes**
   (`RECOVERY-MANIFEST.md` §7 F5, findings D2/D3), and `North Star - Equipment P1v2.dc.html` names two
   different revisions (D1). Nothing at baseline records this. An Atlas Financials pass should settle
   which copy is authoritative before citing either.

---

## 8. UNPROVEN — stated plainly

| Item | Blocker |
|---|---|
| ~~The number of `Current - *.dc.html` files, and their individual names~~ **→ PROVEN 2026-09-13: six, all named (§3.6)** | ~~The register names the class but not the members (`eos-north-star-sources.md:229`); the 27-file total (`:237`) leaves a residue that depends on how bundled rows are expanded. Only the never-vendored `HTML Site Scoping answers needed.zip` could settle it. **No number should be published.**~~ **Resolved** by `pilot-menu.js` in `Scoping answers needed P1.zip`, a delivered index. The instruction not to publish a number was correct on the evidence then available; the residue estimate of "roughly 4" was wrong. **The six files themselves remain SOURCE_UNAVAILABLE.** |
| ~~The individual filenames of the five `1–5 * Before-After.dc.html`~~ **→ PROVEN 2026-09-13, all five named (§3.6)** | ~~Same blocker. Only the count (5) and the naming pattern are recorded (`:228`).~~ **Resolved** from the same delivered index. The count of 5 is confirmed. **All five files remain SOURCE_UNAVAILABLE.** |
| Whether `eos-north-star-design-grammar.md` §8 is the *whole* lost AI continuity model or a summary | The grammar cites no source for §8 (§5.1, zero grep hits), and the source is unavailable. Unresolvable from inside the repository. |
| Whether any lost artifact survives **outside** this repository (Downloads folders, delivery zips, Owner decision-record attachments) — **PARTIALLY RESOLVED 2026-09-13; see the added table below** | Out of scope for a git-based sweep. §1 proves absence **from this repository's object database**, which is the strongest claim available here — it is *not* a claim about the world. `eos-north-star-sources.md:5-8` records that the corpus was recovered from a Downloads-folder zip **once before**, so external survival is plausible and worth pursuing (R10). |
| Whether the content of any SOURCE_UNAVAILABLE artifact matched its register description | Unfalsifiable by construction. The descriptions are the only evidence and cannot be checked against the thing they describe. **Amended 2026-09-13:** still exactly so for the 19 remaining rows. For the 9 recovered files it is **now falsifiable and has not been checked** — the descriptions in §3 and §5 were transcribed from prose and have **not** been compared against the recovered artifacts. |

**Added 2026-09-13 — UNPROVEN after the recovery.**

| Item | Blocker |
|---|---|
| **Whether the shipped Work Order surface conforms to `North Star - Work Order.dc.html` + `Implementation Render - Work Order.html`** | **The artifacts now exist and no one has run the comparison.** This is the single most important open item created by the recovery: a closed 2026-08-25 acceptance is auditable for the first time, and its result is **unknown.** Recovering a yardstick is not measuring with it. |
| Whether the shipped Parts workspace conforms to frames `1a`/`1a-m`/`1b`/`1b-m` | Same, and harder. The surface changed after the deployed `9848ec9d`, and the historic `audit-*.png` baseline (§3.5 r23) is still unavailable, so a mismatch could not be attributed to drift rather than intended change. |
| Whether the Account surface conforms to `North Star - Account P1.dc.html` | Acceptance is still `AWAITING_OWNER_VISUAL_ACCEPTANCE` — there is no closed acceptance to audit against, only DECISIONS #128's reconciliation claim, which is now re-runnable and un-rerun. |
| Whether `docs/north-star/financials/North Star - Financials 16 Reconciliation.dc.html` / `20 Governance.dc.html`, or the delivered copies, are authoritative | `RECOVERY-MANIFEST.md` §7 findings D2/D3: 48 of 50 Financials files are byte-identical to the delivery; these two differ and the repository copies are **larger**. Nothing at baseline records the divergence. |
| Whether the repository's `North Star - Equipment P1v2.dc.html` was intended to be the P1v3-archive revision | Finding D1. The filename names two revisions; no baseline document distinguishes them. |
| Whether `eos-north-star-sources.md:237`'s **"27 HTML files"** is the correct count for the delivered package | The recovered index enumerates **36** filenames. Whether the package was a subset of the menu, the menu linked files never delivered, or 27 is simply wrong, cannot be settled from the custody searched. **Moved to UNPROVEN from being treated as fact in §2.1 and §3.6.** |
| Whether `Implementation Render - Sales Order.html` (recovered) carries any authority status | `RECOVERY-MANIFEST.md` §7 F4. It is **not** `Proposed - Sales Order.dc.html`, which remains unavailable, so DECISIONS #125 is not contradicted on its own terms. An Owner question. |
| Whether the 31 still-unavailable artifacts survive in another custody | **`HTML Site Scoping answers needed.zip` is not in the custody searched.** The row below on external survival is **partially discharged, not closed** — one location was searched and yielded 9 of 29 named files. **R10 stands.** |

**One closing note on scope.** §1 establishes absence from this repository's object database across
1,849 refs, 5,137 commits and 24,191 tree objects — reachable and unreachable. That is the limit of
what git can prove. It does **not** prove the artifacts never existed, and per the ruling the
correct classification is **SOURCE UNAVAILABLE**, not "never existed" or "destroyed."
`Proposed - Sales Order.dc.html` is the cautionary case: the register says *"If this artifact exists,
it has not been seen here"* (`:102`) — the honest form of the claim, and the form this register
keeps throughout.

**Vindicated 2026-09-13, and worth stating.** That restraint is the reason this register did not have
to be retracted. Nine of the twenty-nine named files were produced from custody outside git on
2026-09-13 (§0.4, §1.4). Because the register classified them **SOURCE UNAVAILABLE** rather than
"lost", flagged external survival as **UNPROVEN**, and recommended pursuing it (**R10**), the recovery
**completes** this register rather than refuting it. Every §1 measurement re-verifies today. The
finding was **correct about the repository and incomplete about the world**, and the incompleteness was
one the register had already named. **Nineteen rows and thirty-one files remain genuinely unavailable
(§3.8); no acceptance state changed; no conformance was established.**
