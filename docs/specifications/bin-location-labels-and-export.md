---
artifact_type: specification
gate: Sprint Specification
status: Approved
date: 2026-09-03
owner: Claude Code
related_adrs: ["ADR-014"]
depends_on: ["bin-stable-identity-and-racking-structure", "bin-administration-racking-generator"]
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Sprint Specification: BIN-P5 — Location labels and export

**Architecture:** [ADR-014](../architecture/ADR-014-warehouse-and-bin-inventory-custody-model.md) and **Decision #160**. **Source verified against** `origin/main` @ `616cda50abf5c037f613a89f3d754b6368de06d3` (the commit after BIN-P3's merge `2874070f`) on 2026-09-03.

## Executive summary

A warehouse person cannot scan a shelf that has nothing on it. BIN-P1 gave every bin a stable
identity and BIN-P3 gave an administrator a way to create bins in bulk — but nothing in the system
can yet produce the physical thing that goes on the rack. BIN-P5 closes that: it renders a governed
Bin as a **label** (a human code plus a scannable barcode) and exports the same facts as CSV for
external label tooling.

**A label is a rendering, not a record.** P5 creates no collection, no template store, no label
registry and no second description of where things are. It is a pure projection of
`bins/{binId}` — data the operator has already read — plus a barcode renderer and two output paths
(print, CSV).

**The census found nothing to reuse.** The client has no barcode renderer, no CSV *export* (only a
CSV import parser), no download helper and no print CSS anywhere. P5 builds all four, minimally.

**The scanner boundary needs no change at all.** `normalizeScanToken` already strips an
`EOS-LOC:` prefix, so `EOS-LOC:<binId>` round-trips to the stable `binId` with zero modification to
the shared scan parser. This was verified in source, not assumed.

---

## Verified current state

Everything in this section was read at the pinned commit. Nothing is inferred.

### The scan boundary already accepts the token P5 needs

`field-ops-app-vite/src/domain/scannedIdentity.js:124`:

```js
const stripped = value.replace(/^(TAYLOR|EOS)[-_:](PART|ASSET|WO|LOC|EQUIP)?[-_:]?/i, "");
```

`EOS-LOC:bin_5f3a…` → `EOS` matches, `-` matches `[-_:]`, `LOC` matches the optional group, `:`
matches the optional trailing separator → the remainder is the bare `binId`.

**P5 therefore modifies no scanner code.** That is the single most important census result: it means
the label's machine identity is not a new identity at all, but the one the scanner already resolves.

### The trusted resolver already returns the canonical answer

`functions/src/inventoryLocation/binRegistry.ts:444` `resolveBinFromToken` requires a `bin_`-prefixed
safe id and returns, on success:

```ts
{ result: "FOUND", binId, warehouseId, code, location: { type: "BIN", locationId: binId } }
```

That is exactly the required round-trip destination.

### The governed list already returns every field a label needs

`functions/src/inventoryLocation/binCommands.ts:415` `listBinsForWarehouse` returns per bin:

`binId`, `code`, `name`, `status`, `area`, `aisle`, `bay`, `position` — and deliberately **not**
`idempotencyKey` and **not** `fingerprint`.

**P5 therefore needs no backend change and no new callable.** The label projection consumes the P3
list result verbatim.

### Warehouse identity is already available client-side

`AdminWarehouseRacking.jsx` already loads warehouses through the governed `fetchWarehouses()` read
and holds `{ id, name }`. A label may show the warehouse name without any new read.

### What does NOT exist (measured, not assumed)

| Capability | Present? | Evidence |
|---|---|---|
| Barcode renderer (any symbology) | **No** | zero matches for `code128` / `Code128` / `qrcode` / `QRCode` under `src/` |
| Barcode dependency | **No** | `package.json` dependencies are `firebase`, `lucide-react`, `react`, `react-dom`, `react-router-dom` |
| CSV **export** | **No** | only `domain/contactCsvImport.js`, which *parses* RFC 4180 |
| Download helper (`createObjectURL`, `download=`) | **No** | zero matches under `src/` |
| Print CSS (`@media print`) or `window.print` | **No** | zero matches under `src/` |
| ZPL / printer bridge / print server | **No** | zero matches |

P5 builds the barcode renderer (via one dependency), the CSV writer, the download helper and the
print stylesheet. Each is small and each is new.

---

## Authority model

**The durable physical-location authority remains `bins/{binId}`, unchanged.**

```
  bins/{binId}                      ← the only durable authority (BIN-P1, Decision #160)
        │
        ▼
  buildBinLabel()                   ← pure projection, in memory, no write, no clock
        │
        ├──▶ canonicalCode           "A01-003"     the human sees this
        └──▶ machineToken            "EOS-LOC:bin_5f3a…"   the scanner sees this
                    │
                    ▼
              barcode rendering (SVG) · CSV export
```

**P5 creates none of these:** `location_labels`, `bin_labels`, `label_registry`, `printed_labels`,
`barcode_locations`, `location_aliases`, `label_templates`, `label_settings`.

**Why this matters more than it may appear.** The moment a label store exists, it becomes a second
answer to "where is A01-003?", and the two answers drift the first time one is written without the
other. The whole BIN programme exists because that had already happened once with `stock_locations`
(retired in BIN-P2/P2R). A label is a *photograph* of a bin, not a *copy* of it.

### Read authority

P5 uses the existing `inventory.location.bin.read`. It adds no capability, activates nothing, grants
nothing, changes no Rules, and performs no direct client Firestore read of `bins` or
`bin_code_claims` — it consumes the P3 governed list result.

### Is client-side export a separate authority? — examined, and no

Stop condition 13 asks whether existing governance explicitly treats client-side export of
already-readable facts as a separate exfiltration authority. Two records touch this and both were
read in full:

- **ADR-007 §2.8** says "CSV is the first and only export format at first activation. Export is a
  **separately-governed capability** distinct from viewing." That governs the **governed report
  creator**: a server-side engine that composes arbitrary fields across every business object under
  a field-level catalog, where export must be re-authorized because the *server* projects fields the
  runner may never have opened, and because an unbounded query is an exfiltration channel. ADR-007
  is also explicitly **design-stage only, docs-only, authorizing no implementation**, and the report
  creator does not exist.
- **DECISIONS.md (Bulk Data v1 invariants)** states the governing rule: **"export authority may never
  exceed the initiating user's read scope"**, and "Export All" means all within *their* authorized
  scope.

That second one is the live invariant, and it is a **constraint P5 satisfies exactly**, not a
permission P5 lacks: the CSV contains precisely the rows `listBins` already returned to this user
under `inventory.location.bin.read`, with no additional field, no additional read and no other
object. There is no query, no field catalog, no server-side projection and no sink beyond the
operator's own browser.

**Conclusion: no governance stop.** Rendering a fact you are authorized to see, on the screen you
are already seeing it, is not a new authority. This reasoning is recorded here rather than left
implicit, because it is exactly the kind of judgement that should be auditable later.

**If a future governed export capability is introduced platform-wide**, P5's export is a candidate to
be brought under it. That would be an ordinary later change, not a defect in this design.

---

## Scope

1. A pure label projection over a governed Bin.
2. A deterministic scan-token helper, `toBinScanToken(binId)`.
3. A local Code 128 barcode renderer producing SVG.
4. A **Labels & Export** section inside the existing Administration → Warehouse Racking surface:
   selection, preview, print, CSV download.
5. A print stylesheet that prints labels and nothing else.
6. A per-row **Label** action so a renamed bin can immediately produce its current label.
7. Documentation: user guide, implementation plan, this specification's evidence.

## Non-goals

Explicitly out of scope, each for a stated reason:

| Not built | Why |
|---|---|
| Any label collection or template store | It would be a second location authority (see above) |
| Persisted symbology / dimension / font / sheet-size configuration | C-4 and C-5 are unconfirmed; persisting a guess is worse than a session default. YAGNI |
| `labelVersion`, `lastPrintedCode`, `printedAt`, `physicalLabelStatus` | EOS has no way to know what is physically stuck to a shelf; a field claiming otherwise would be fiction |
| Direct printer drivers, network printer discovery, print server, Zebra/ZPL bridge, Windows print agent | No such infrastructure exists to reuse; C-5 is unconfirmed |
| PDF generation infrastructure | The repository owns none, and browser print plus SVG covers v1 |
| QR or any second symbology | One working symbology beats an unused selector abstraction |
| A formatter-width control, or bulk rename | P3 established these are not offered; C-1 is a client convention question, not a repository one |
| Any quantity, custody, ledger, roll-up or Cycle Count change | P5 is presentation; custody is BIN-P6 |
| A new backend label-read callable | `listBins` already returns every needed field |

---

## The label projection

One pure module, `field-ops-app-vite/src/domain/binLabel.js`. No React, no Firebase, no clock, no
write, no persistence — directly unit-testable in Node, the same pattern as
`domain/rackingLayoutGenerator.js`.

### `toBinScanToken(binId)`

```
toBinScanToken("bin_5f3a…")  →  "EOS-LOC:bin_5f3a…"
```

The prefix is a constant (`BIN_SCAN_TOKEN_PREFIX = "EOS-LOC:"`) matching the existing
`normalizeScanToken` vocabulary. The function is deterministic and total: the same `binId` always
produces the same token.

**The token is derived from `binId` and from nothing else.** Not from `area`, `aisle`, `bay`,
`position`, `code` or `name`. This is the load-bearing property of the whole phase: a rename changes
the human code on the wall, but the barcode already stuck to the shelf keeps resolving to the same
place. A token derived from the code would silently invalidate every printed label the first time
someone corrected a typo.

### `buildBinLabel(bin, warehouse?)`

Returns a frozen plain object:

| Field | Source | Note |
|---|---|---|
| `binId` | `bin.binId` | machine identity |
| `warehouseId` | `warehouse?.id ?? null` | |
| `warehouseName` | `warehouse?.name ?? null` | display only, may be absent |
| `area`, `aisle`, `bay`, `position` | the governed bin | structure, unmodified |
| `canonicalCode` | `bin.code` | **the server's code**, never re-derived client-side |
| `machineToken` | `toBinScanToken(bin.binId)` | |
| `status` | `bin.status` | `ACTIVE` \| `INACTIVE`, preserved truthfully |

`canonicalCode` is copied, never recomputed. The formatter is server-owned (BIN-P1), and a client
that re-renders the code introduces a second formatter that can disagree with the registry — the
same class of defect P3's trusted preview exists to prevent.

The projection carries **no** `idempotencyKey`, **no** `fingerprint`, **no** claim data, **no**
audit fields and **no** quantity. `listBins` does not return the first three, so this is structural
rather than a matter of discipline.

### `buildBinLabels(bins, { warehouse, includeInactive })` and `sortBinLabels(labels)`

Deterministic order, applied to both preview and CSV:

```
area (locale-independent string compare)
  → aisle (string)
    → bay (numeric)
      → position (numeric)
        → binId (final tie-breaker, so order is total)
```

Bay and position sort **numerically**, not lexically: `bay 2` before `bay 10`, which a string sort
gets backwards. The `binId` tie-breaker makes the order total, which is what makes a repeated export
byte-stable.

---

## Visible label content

The physical label is deliberately sparse.

```
┌────────────────────────────────┐
│  ███ ▌█ ▌▌██ ▌█ ███ ▌▌█ ██     │   ← Code 128, payload EOS-LOC:<binId>
│                                │
│         A01-003                │   ← canonical code, visually dominant
│   Phoenix · PARTS ROOM         │   ← optional context, small
└────────────────────────────────┘
```

- **Primary:** the canonical human code, the largest thing on the label.
- **Secondary, optional:** warehouse name and area, small, only when available.
- **Encoded but not printed large:** the machine token, inside the barcode.
- **Never printed:** `binId` as prominent human text, any database path, quantity, on-hand,
  available, reserved, or audit metadata.

A person standing at a rack needs to read one thing from three metres away. Everything else is
noise, and a label crowded with internal identifiers invites someone to type one into a form.

An `INACTIVE` bin's label must carry a visible **OUT OF USE** mark. A label that looks operational
for a retired location is worse than no label.

---

## Symbology and renderer

**Code 128 is the implementation default.** It represents the required alphanumeric payload
(`EOS-LOC:` plus a `bin_`-prefixed hex id), is supported by essentially every dedicated scanner, and
— decisively — **does not participate in identity**. The payload is fixed by
`toBinScanToken`; the symbology is only how those characters are drawn. Changing the renderer later
changes no `binId`, no token, and no printed label's meaning.

**C-4 (client's preferred symbology) remains open** and is a mass-rollout gate, not a repository
blocker.

### Renderer requirements

The census found no barcode capability, so P5 adds **one** small maintained client-side renderer.
Requirements, all of which are testable:

- Renders **locally**. No network request, no remote image URL, no rendering API, no tracking.
- Deterministic output for a given payload.
- **SVG output**, so scaling to any label size does not soften the bar edges the way a raster image
  would. Vector-first is what makes the label printable at a size nobody has chosen yet (C-5).
- Failure is **visible**: a renderer error shows an explicit error in place of that label and must
  not take down the Administration page. A label silently missing its barcode is a label someone
  sticks on a shelf and cannot scan.

Hand-writing the Code 128 encoding (start codes, code-set switching, the weighted mod-103 check
digit, stop pattern) is not undertaken — it is a well-specified algorithm with a checksum that is
easy to get subtly wrong, and a subtly wrong barcode fails in the warehouse rather than in CI.

If the first chosen dependency is rejected by package policy or CI, another minimal suitable one is
selected. That is an ordinary implementation decision.

---

## Print

Browser-native print from a dedicated printable container. No printer communication of any kind.

Print CSS must:

- hide Administration navigation, page chrome, buttons and form controls;
- print **only** the selected labels;
- preserve the barcode at high contrast with its quiet zones intact, and never rely on a decorative
  background the printer will drop;
- avoid splitting a single label across a page boundary (`break-inside: avoid`);
- not force the app shell into the output.

**No physical label size is committed.** Choosing inches or millimetres now would bake in an answer
to C-5 that Taylor has not given. The preview uses a practical grid and lets the browser and printer
negotiate media.

If browser print proves fragile under test, a downloadable SVG/HTML artifact is an acceptable v1
print artifact.

Printing performs **no write**: no backend call, no mutation, no state flag.

---

## CSV export

Deterministic UTF-8 CSV from the **same** projection the preview renders. One source, two sinks —
a separate export model is how a preview and a file start disagreeing.

### Columns

```
warehouseId,binId,area,aisle,bay,position,code,scanToken,status
```

`name` is **excluded by default**. It is the one free-form, operator-typed field on a bin, and
excluding it removes the formula-injection surface entirely rather than mitigating it. Nothing about
a label needs it.

### Escaping — RFC 4180

Field quoted when it contains a comma, a double quote, CR or LF; embedded quotes doubled.
`CRLF` line terminators. This mirrors the conventions the existing `contactCsvImport.js` parser
already reads, so EOS's own importer round-trips its own export.

### Formula-injection guard

CSV is an executable-adjacent format: a spreadsheet interprets a leading `=`, `+`, `-` or `@` as a
formula. The governed bin fields are structurally validated and should never begin with those
characters — but "should never" is not a control. Every emitted value passes through a neutralizer
that prefixes a dangerous leading character with `'`, and this is **tested**, including for
`warehouseName` should it ever be included.

### Determinism

The same bins exported twice produce **byte-identical** output. There is deliberately **no timestamp
inside the CSV body** — a timestamp would make every export differ from the last and destroy the
ability to diff two exports to see what actually changed about the racking.

### Filename

```
bin-labels-<sanitized-warehouse-id>.csv
```

Sanitization: lower-case, non-`[a-z0-9-]` collapsed to `-`, bounded length, no path separator, no
leading dot. A free-form warehouse name never reaches the filename unsanitized.

### Naming honesty

The artifact is called a **Location label CSV**. It is **not** described as an Insight Works — or any
other vendor's — certified import format, because no such schema has been verified in this
repository. Claiming vendor compatibility that has not been tested is how an operator discovers at
rollout that the file does not load.

---

## Selection and preview

- **Default: `ACTIVE` (In use) bins only.** Inactive locations are excluded by default; nobody wants
  to print a wall of labels for shelves that are out of service.
- **Select all visible** applies to the currently visible, in-use bins — what the operator can see is
  what it selects.
- Including inactive bins requires an **explicit** choice, and any inactive label is visibly marked
  **OUT OF USE**.
- **Zero selected → truthful empty state**, and both Print and Export are unavailable. No file is
  produced that pretends to contain labels.
- Status wording follows the P3/ADR-012 vocabulary already corrected in that phase: **In use** /
  **Out of use**, never a bare "Active".
- Status is never colour-only; every state carries words.

The preview is produced from the same `buildBinLabels` result that the CSV serializes.

---

## Rename and reprint — the honest position

After a successful rename, the P3 screen already refreshes the bin list, so the row immediately
carries the new canonical code and can produce the current label at once. A per-row **Label** action
is sufficient. No automatic print, no popup.

**What P5 must not do:** persist `labelNeeded`, `labelVersion`, `lastPrintedCode` or `printedAt`.
EOS has no evidence of what is physically attached to a shelf, and a flag implying otherwise would
be a fact the system cannot support.

**What the UI may truthfully say:**

> Renaming changes the printed code, not the barcode. Reprint this label after a location-code
> change.

**What it must never say:** "all physical labels are current."

The barcode on the wall keeps working after a rename — that is the direct payoff of deriving the
machine token from `binId`.

---

## Administration integration

Inside the existing **Administration → Warehouse Racking** surface, as a **Labels & Export** section
below the existing bin list. No second Administration application, no new global route, no second
nav entry, no second location catalog to read from — the existing racking list is the source.

Available when a warehouse is selected and the bin list was read successfully.

---

## Capability posture and honest states

`inventory.location.bin.read` and `inventory.location.bin.manage` both remain `active: false` and
granted to no role. P5 inherits P3's honest posture unchanged:

- Without `bin.read`: Labels & Export states it is **unavailable** and names the capability.
- **A denied read is never rendered as "0 labels."** An access denial and an empty warehouse look
  identical on screen and mean entirely different things.
- No fixtures, no sample labels, no fabricated bins.

---

## Accessibility

- Every preview control is keyboard operable; Print and Export have explicit names.
- Each label preview exposes an accessible textual identity (its canonical code and location), so the
  barcode is never the only representation of the code — a screen-reader user and a printer both get
  the code.
- The barcode SVG carries a text alternative and is not announced as meaningful decoration.
- The unavailable/protected state explains **why**, not merely *that*.
- Status is conveyed with words, never colour alone.

## Responsive

- 1440 desktop and tablet render the label grid normally.
- **375px must have no horizontal page overflow.** The label grid reflows; if a single label cannot
  fit, it scrolls inside its own container rather than pushing the page sideways.
- The human code never shrinks below legibility to make a grid fit.

---

## Deployment dependency (carried forward unchanged)

**BIN-P2R and BIN-P3 are merged but UNDEPLOYED. P5 will be too.**

Before any P5 Hosting release, a coordinated sandbox release must ensure the live bundle and Rules
combination is safe:

```
required Functions  →  new Hosting bundle  →  stock_locations-denying Rules
```

- old Rules + new Hosting: **SAFE**
- new Rules + old Hosting: **UNSAFE** — a live bundle still reading `stock_locations` against Rules
  that deny it.

**No deployment is performed or authorized in this phase.**

---

## Client rollout gates (open, and not repository blockers)

| Gate | Question | Implementation default | Status |
|---|---|---|---|
| **C-1** | Warehouse bay display width | The **current authoritative** formatter: bay 2, position 3 (`A01-001`). P5 adds no width control and renames no bin | Open — mass-print / client acceptance |
| **C-4** | Preferred barcode symbology | **Code 128**. Identity does not depend on it | Open — client confirmation before mass rollout |
| **C-5** | Physical label medium (thermal/ZPL vs laser/sheet) | Browser print + CSV export; no media size committed | Open — operational rollout choice |

**None of these blocks repository implementation**, and the current defaults are **not** represented
as client acceptance. P5 complete means *EOS can generate correct labels and export their source
data*. It does **not** mean Taylor has chosen final media or printed the warehouse.

---

## Tests

### Identity
1. The machine token derives from the stable `binId`.
2. The visible code does not determine the machine token.
3. A rename changes the visible code but **not** the machine token.
4. The same `binId` always produces the same scan token.
5. `normalizeScanToken(toBinScanToken(binId))` returns exactly `binId`.
6. No forked scan parser: P5 imports the shared `normalizeScanToken` and defines no second one.

### Label model
7. One governed bin produces exactly one label projection.
8. `canonicalCode` is present and is copied from the server's `code`, not re-derived.
9. `area` is preserved unmodified.
10. Bay ordering is numeric (2 before 10).
11. Position ordering is numeric.
12. No quantity field of any name appears in the projection.
13. No `idempotencyKey`.
14. No `fingerprint`.
15. No claim document or claim field.
16. `INACTIVE` status is preserved truthfully.

### Barcode
17. The Code 128 renderer produces a real machine-readable barcode representation for the payload.
18. The renderer is local — no network call is made.
19. The encoded payload is the exact scan token.
20. The visible code remains text, independent of the bars.
21. A renderer failure fails visibly and does not crash the surrounding page.
22. No remote image service or external URL appears in the rendered output.

### CSV
23. Deterministic header.
24. Deterministic row ordering (area → aisle → bay → position → binId).
25. RFC 4180-style quoting and escaping.
26. UTF-8.
27. The `scanToken` column is exact.
28. The `code` column is exact.
29. No quantity column.
30. Formula-dangerous leading characters are neutralized in any included free-form field.
31. The same input exported twice is byte-identical.
32. The filename is sanitized and contains no path separator.

### Selection and preview
33. `ACTIVE` is the default selection.
34. `INACTIVE` bins are excluded by default.
35. Including inactive bins is an explicit action, and such labels are marked OUT OF USE.
36. Zero selection produces no export and no false artifact.
37. Only selected rows appear in preview and export.
38. Select-all-visible selects the visible in-use bins.
39. Preview and CSV are built from the same projection.
40. Status is not conveyed by colour alone.

### Print
41. Administration chrome is hidden in print.
42. Only selected labels print.
43. A label is not split across pages (`break-inside: avoid`).
44. The human code remains visible in print.
45. The barcode is retained in print.
46. Printing mutates no bin.
47. Printing calls no backend write.

### Administration
48. Labels & Export lives inside the existing Warehouse Racking surface.
49. No second route family or second nav entry is introduced.
50. Unavailable when `bin.read` is unavailable.
51. A denial is not rendered as an empty label set.
52. A rename can be followed by regenerating the current label.
53. No delete affordance.
54. No claim-release affordance.
55. No formatter-width control.

### Authority
56. No new capability is registered.
57. No capability `active` flag changes.
58. No role grant changes.
59. No `firestore.rules` change in either governed copy.
60. No direct client Firestore read of `bins`.
61. No direct client Firestore read of `bin_code_claims`.
62. No label collection is introduced.
63. No persistent label configuration is written.
64. No inventory ledger write.
65. No BIN custody.
66. No Cycle Count change.
67. `stock_locations` remains absent (BIN-P2R holds).
68. BIN-P3 remains intact (preview, generator and racking screen still pass).

### Accessibility
69. Preview controls are keyboard usable.
70. Each preview label has an accessible textual identity.
71. The barcode is not the only representation of the code.
72. Download and print buttons have clear accessible names.
73. The protected/unavailable state explains why.

### Responsive
74. 1440 renders correctly.
75. Tablet renders correctly.
76. 375px produces no horizontal page overflow.
77. The label grid adapts without shrinking the human code into unreadability.

Additional tests are added as implementation requires; this list is a floor, not a quota.

---

## Acceptance criteria

1. `toBinScanToken(binId)` round-trips through the **unmodified** shared `normalizeScanToken` to the
   stable `binId`, and onward through `resolveBinFromToken` to `{ type: "BIN", locationId: binId }`.
2. A rename changes the canonical code and leaves the machine token identical.
3. The label projection is pure, persists nothing, and contains no quantity, `idempotencyKey`,
   `fingerprint` or claim data.
4. Barcodes render locally as SVG with no network request.
5. CSV is deterministic, RFC 4180-escaped, formula-safe, and byte-identical across repeated exports
   of unchanged input.
6. Labels & Export is inside the existing Warehouse Racking surface, defaults to in-use bins, and
   marks any inactive label OUT OF USE.
7. Without `bin.read`, the surface says it is unavailable and never shows "0 labels".
8. No new capability, activation, grant, Rules change, label collection, persistent label
   configuration, backend callable or client-direct Firestore read.
9. All P1, P2R and P3 regression suites pass; Vite build clean; new suites registered in an owning
   Linux CI workflow (not a debt allowlist).
10. Documentation states plainly that C-1, C-4 and C-5 remain open mass-rollout gates.

---

## Risks

| Risk | Mitigation |
|---|---|
| A barcode that scans in CI but not on a real scanner | Vector SVG, quiet zones preserved, high contrast, no background dependency. Physical verification is part of the C-4/C-5 rollout gate, and this specification does not claim it |
| An operator prints labels, then someone renames the bins | The barcode stays valid — only the printed human code goes stale. The UI says to reprint after a code change and never claims labels are current |
| A new dependency introduces supply-chain surface | One small maintained renderer, local-only, no network, lockfile committed, verified to make no request |
| Spreadsheet formula injection through CSV | `name` excluded by default; every value neutralized; tested |
| The 375px label grid overflowing the page | Explicit responsive test; label scrolls in its own container, never the page |
| P5 shipping before P2R/P3 deploy, with Rules ordered wrongly | Recorded as a release prerequisite with the safe order stated; no deployment in this phase |

## Rollback

P5 is additive and client-only. Reverting the implementation commit removes the Labels & Export
section, the label domain module, the barcode component and the print stylesheet. Because P5 writes
nothing, persists nothing and changes no authority, **a rollback leaves no residue** — no collection
to clean up, no flag to unset, no printed-state to reconcile. The bins themselves are untouched.

## Approval

Pending review. **Implementation is not authorized by the existence of this document.**
