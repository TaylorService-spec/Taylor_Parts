# KEYSTONE DATA EXCHANGE — NORTH STAR P2v2 · CONFIGURATION & MIGRATION HANDOFF
Self-contained handoff for an external assistant (no project file access required). Builds on the P1v4 handoff (KDX-P1v4-implementation-handoff.md): the P1 visual system, shell, status/capability vocabulary, fixture, decisions KDX-D1..D10, and component templates all apply unchanged. P1 is CLOSED.

## Design sources
Frames 11–16: New Integration Wizard canvas. Frames 17–21: Migration canvas. All 1440px except frame 21 (375px).

## Information architecture
Configuration flows run in a **focused full-page shell** (KDX-D11): brand · flow name · tenant + environment words (SANDBOX · NOT CERTIFIED) · "Save draft & exit" · stepper. No operational rail — the operator is composing, not monitoring; monitoring stays on P1 surfaces (Runs, Exceptions, Overview). Exit always preserves a named draft.
Wizard steps: Connection → Direction → Data → Mapping → Rules → Validate → Dry run → Review → Activate.
Migration steps: Upload → Inspect → Map → Validate → Dry run → Review → Execute → Reconcile (Map/Validate/Dry run/Review reuse the wizard frames' patterns verbatim).

## Frames
11 Connection & Direction — connection radios with state facts; File upload routes to Migration; outbound/bidirectional radios preserved DISABLED with "Awaiting Certification" (structural slot, honest reason).
12 Data selection — live entity reads with record counts, dependency facts, destination entity; unmappable entity states why it can't be selected.
13 Field Mapping — SOURCE → DESTINATION table; states Mapped / Suggested — confirm / Ignored / Required — unmapped (magenta) / Invalid — add transform (magenta-800); inline expanded configuration row (Transform · Default · Enum translation · Relationship · Validation · Authority), one at a time; JSON is a governed read behind Advanced, never the primary interface; "Accept all suggestions" secondary.
14 Rules — three columns: Field authority (endpoint-local tag choices — source / destination / Manual review — with the plain-language retention sentence printed under each choice; no third system); Identity (External ID / Business key / Composite match; no-confident-match ⇒ manual review; uncertain matches never merge silently); Duplicates (Hold for review is the ONLY P2 policy; no auto-merge; "Create anyway despite possible duplicate" is a deferred capability requiring a future governed tenant/admin policy — removed from P2, not an open question).
15 Validate & Dry run — validation gate (Connection / Required mapping / Data types / Identity rules / Authority rules Passed; Relationships 1 warning with the one fixing action); gate re-runs after each fix; dry run disabled until failures clear (warnings may proceed). Dry run is first-class: NO DESTINATION WRITES; 18,421 classified → 14,210 Create · 3,088 Update · 604 Link · 391 Warning (non-blocking; applied with the warning recorded) · 117 Possible duplicate (held) · 11 Blocked (held); every row drills into the record list; same pipeline as execution. DRY RUN PROVENANCE line pins what was proven: dry-run ID (DR-000214) · timestamp · landing snapshot (LS-8841) · source fingerprint (a3f2…c91) · configuration version (v7) · mapping/rules version (v12). Execution is bound to exactly these versions; any change ⇒ DRY RUN STALE, execution disabled, one action: Re-run dry run.
16 Review & Activate — impact numbers (18,293 eligible to apply; 391 of those carry non-blocking warnings that will be recorded; 128 expected held for review — 117 possible duplicates · 11 blocked; held records never written silently) + configuration facts + environment word; "Activate integration" one-click, no dialog — the review IS the confirmation; "Save without activating" secondary.
17 Upload & Source inspection — truthful facts (filename, size, worksheet, record count, column count, header confirmation, raw-landing state) + validation observations (312 blank BillingEmail · 11 missing Region · 2 in-file duplicate keys) + read-only detected-fields/sample table (NOT a spreadsheet editor; type overrides happen in Mapping; mixed date formats flagged for transform).
18 Execute confirmation — "18,293 records are eligible to apply." · "391 of those records contain non-blocking warnings that will be recorded." · "128 records are expected to be held for review: 117 possible duplicates · 11 blocked." · full dry-run provenance (ID, snapshot, fingerprint, config + mapping versions, Re-run) · environment word · one primary Execute migration, no added ceremony. If provenance no longer matches: DRY RUN STALE, Execute disabled.
19 Running — processed/remaining counters (8,432 / 9,989 of 18,421), current stage, 47% record-based progress, "no time estimate" (KDX-D7), exceptions reviewable mid-run in the P1 inbox. Pause is capability-driven: rendered only while the runtime reports canPause = true (durable safe checkpoint); absent when canPause = false; after a successful pause the page shows the persisted checkpoint state. Matches the P1 rule: resumable only when a durable checkpoint is intact.
20 Completion & Reconciliation — completion is a reconciliation verdict, not a processing stop (separate timestamps); ledger: 18,421 source · 18,421 processed · 18,293 applied (of which 391 applied with warnings recorded) · 128 exceptions held · 18,293 destination confirmed. Arithmetic: 18,421 = 18,293 + 128 — warnings are supplementary evidence inside the applied count, never an additive bucket (never 18,293 + 391 + 128). Handoff distinguishes: 391 applied-with-warnings retained as run/reconciliation evidence (NOT inbox records); 117 possible duplicates → Identity exceptions; 11 blocked → External Rejection exceptions. A warning enters the Exceptions inbox only if it instantiates a governed category (Identity · Conflict · Validation · Relationship · External Rejection · Connector); only the 128 held records are handed to the P1 workflow. Pending-state sentence per KDX-D10.
21 375 monitoring — read-only status card (8,432 of 18,421), 44px rows, "Best configured on a larger screen" for Mapping/Rules; nothing silently removed; Pause subject to the same canPause capability rule as desktop.

## Component additions (all Broadsheet-native)
Stepper (13px numbered steps, ✓ on completed, cyan bold current) · connection/direction radio rows with state facts · entity selection table · mapping table with state column and inline expansion row (accent-100 fill) · authority tag-choice row with policy sentence · validation gate grid · dry-run classification grid with View drills · impact statement block · focused-shell header.

## State & error behavior
Mapping states: Mapped · Suggested · Ignored · Required · Invalid — word-first, magenta only for Required-unmapped and Invalid. Validation failures name records and carry one fixing action.
Draft durability (KDX-D11 clarified): "Save draft & exit" = persist draft → receive durable success → exit. On persistence failure: remain in the flow, show a truthful save-failure message, preserve recoverable local form state where safely possible, never claim the draft was saved, offer Retry. Step advancement persists enough draft state to reopen at the last durably saved/incomplete step; durable progress is never claimed from browser state alone.
Dry-run staleness: execution is bound to the dry run’s proven source snapshot/fingerprint and configuration/mapping versions. Any change after the dry run ⇒ DRY RUN STALE, execution disabled, operator action Re-run dry run. Execution never silently reclassifies changed input after impact approval; defensive validation during execution is not authorization to replace the reviewed dataset.
Pause: capability-driven (canPause from the runtime); button absent without a durable checkpoint; post-pause the persisted checkpoint state is shown.

## Certification boundaries honored
Outbound/bidirectional: disabled radios with Awaiting Certification, never active. Authority: retention-only language on the certified inbound path; no propagation implied. Resolution chains: KDX-D10 pending states quoted on frame 20. Environment: SANDBOX · NOT CERTIFIED on every frame including 375.

## Responsive rules
Configuration is desktop-first (1440). 1024: same layouts, columns drop to 1–2. 375: read-only monitoring + status; complex configuration read-only with the larger-screen sentence; 44px targets.

## Report
New Integration Wizard: COMPLETE (frames 11–16) · Migration: COMPLETE (17–21) · Source Inspection: COMPLETE (17) · Mapping: COMPLETE (13) · Authority: COMPLETE (14) · Identity: COMPLETE (14) · Validation: COMPLETE (15) · Dry Run: COMPLETE (15) · Execution: COMPLETE (18) · Migration Running: COMPLETE (19) · Completion: COMPLETE (20) · Reconciliation: COMPLETE (20, detail reuses P1 frame 06) · Exception Handoff: COMPLETE (20 → P1 inbox) · Responsive: COMPLETE for migration monitoring (21); wizard 1024/375 read-only variants follow the stated rules, frames on request.

OPEN PRODUCT-POLICY QUESTIONS: NONE.
Deferred capability (not a question): "Create anyway despite possible duplicate" requires a future governed tenant/admin policy and is not part of P2.
Named decisions added: KDX-D11 (focused full-page shell for configuration flows, with durable-draft semantics) · KDX-D12 (dry-run provenance binds execution; stale ⇒ disabled) · KDX-D13 (capability-driven Pause) · KDX-D14 (warnings are run evidence, not automatic exceptions; only governed categories enter the inbox).


## Component template HTML (P2 additions)
Token values inlined as in the P1v4 handoff (ground #f3f2f2, ink #201e1d, cyan #0088b0/#006a8a, magenta #a30052/#7d003f, neutrals #4a4846/#6b6866/#8a8785/#b5b2b0/#dedcdb; Source Serif 4; radius 2px).

### Focused configuration shell (KDX-D11)
```html
<section style="background:#f3f2f2;color:#201e1d;font-family:'Source Serif 4',Georgia,serif;padding:36px 64px 64px;display:flex;flex-direction:column;gap:40px;">
  <header style="display:flex;justify-content:space-between;align-items:baseline;">
    <div style="font-size:15px;"><span style="font-weight:700;">Keystone Data Exchange</span> <span style="color:#6b6866;">· New integration · Legacy CRM → Service Platform</span></div>
    <div style="font-size:12.5px;color:#6b6866;">Northwind Services · <span style="font-weight:700;color:#201e1d;letter-spacing:.06em;">SANDBOX · NOT CERTIFIED</span> · <a href="#" style="color:#006a8a;text-decoration:none;">Save draft &amp; exit</a></div>
  </header>
  <nav style="display:flex;gap:24px;font-size:13px;color:#8a8785;flex-wrap:wrap;">
    <span style="color:#6b6866;">1 Connection ✓</span><span style="color:#6b6866;">2 Direction ✓</span>
    <span style="font-weight:700;color:#006a8a;">3 Data</span>
    <span>4 Mapping</span><span>5 Rules</span><span>6 Validate</span><span>7 Dry run</span><span>8 Review</span><span>9 Activate</span>
  </nav>
  <!-- step content -->
</section>
```

### Disabled awaiting-certification direction radio
```html
<label style="display:flex;gap:10px;align-items:center;font-size:15.5px;"><input type="radio" name="dir" disabled><span style="color:#8a8785;">Outbound</span> <span style="font-size:12.5px;font-weight:600;color:#6b6866;">— Awaiting Certification</span></label>
```

### Mapping row (+ states)
```html
<tr>
  <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;font-weight:600;">CompanyName</td>
  <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;color:#0088b0;">→</td>
  <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;">Name <span style="font-size:11px;letter-spacing:.1em;color:#8a8785;">REQUIRED</span></td>
  <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;font-size:13px;color:#4a4846;">Trim · Title case</td>
  <td style="padding:12px 0;border-bottom:1px solid #dedcdb;font-weight:600;">Mapped</td>
</tr>
```
State cell variants: Mapped (ink 600) · "Suggested — confirm" (#006a8a 600) · Ignored (#6b6866 600) · "Required — unmapped" (#a30052 700) · "Invalid — add transform" (#7d003f 700). Expanded configuration renders as a full-width row directly beneath (background #d3ecf3 tint), one at a time; kicker "ENUM TRANSLATION — ACTIVEFLAG → ACTIVE"; JSON only behind an "Advanced" link.

### Authority choice with policy sentence
```html
<div>
  <div style="font-weight:600;font-size:14.5px;">Customer Name</div>
  <div style="display:flex;gap:8px;margin-top:6px;">
    <span style="font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:2px;background:#0088b0;color:#fff;">Service Platform</span>
    <span style="font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:2px;border:1px solid #b5b2b0;color:#4a4846;">Legacy CRM</span>
    <span style="font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:2px;border:1px solid #b5b2b0;color:#4a4846;">Manual review</span>
  </div>
  <div style="font-size:12.5px;color:#6b6866;margin-top:6px;">When incoming data conflicts with the current value, the Service Platform value is retained.</div>
</div>
```
Choices are endpoint-local (this integration's source/destination) plus Manual review — never a third system.

### Validation gate
```html
<div style="display:grid;grid-template-columns:1fr auto;gap:14px 32px;font-size:15px;max-width:380px;">
  <span>Connection</span><span style="font-weight:600;">Passed</span>
  <span>Required mapping</span><span style="font-weight:600;">Passed</span>
  <span>Data types</span><span style="font-weight:600;">Passed</span>
  <span>Identity rules</span><span style="font-weight:600;">Passed</span>
  <span>Authority rules</span><span style="font-weight:600;">Passed</span>
  <span>Relationships</span><span style="font-weight:700;color:#a30052;">1 warning</span>
</div>
```
Every failure/warning names its records and carries exactly one fixing action link. Gate re-runs after each fix; dry run disabled until failures clear (warnings may proceed).

### Dry-run classification grid
```html
<div style="display:grid;grid-template-columns:auto 1fr auto;gap:10px 24px;font-size:15px;max-width:560px;">
  <span style="font-weight:600;text-align:right;">14,210</span><span>Create</span><a href="#" style="font-size:13.5px;font-weight:600;color:#006a8a;text-decoration:none;">View</a>
  <span style="font-weight:600;text-align:right;">3,088</span><span>Update</span><a href="#" style="font-size:13.5px;font-weight:600;color:#006a8a;text-decoration:none;">View</a>
  <span style="font-weight:600;text-align:right;">604</span><span>Link</span><a href="#" style="font-size:13.5px;font-weight:600;color:#006a8a;text-decoration:none;">View</a>
  <span style="font-weight:600;text-align:right;">391</span><span>Warning — non-blocking, applied with warning recorded</span><a href="#" style="font-size:13.5px;font-weight:600;color:#006a8a;text-decoration:none;">View</a>
  <span style="font-weight:700;text-align:right;color:#a30052;">117</span><span>Possible duplicate — held</span><a href="#" style="font-size:13.5px;font-weight:600;color:#006a8a;text-decoration:none;">View</a>
  <span style="font-weight:700;text-align:right;color:#7d003f;">11</span><span>Blocked — held</span><a href="#" style="font-size:13.5px;font-weight:600;color:#006a8a;text-decoration:none;">View</a>
</div>
```
Headline carries "NO DESTINATION WRITES" (15px, 600, .08em, #6b6866). Dry run uses the same pipeline as execution; every class drills to its record list.

### Impact statement (execute confirmation)
```html
<h1 style="margin:0;font-size:36px;font-weight:600;letter-spacing:-0.015em;">18,293 records are eligible to apply.</h1>
<div style="font-size:17px;color:#4a4846;margin-top:14px;line-height:1.6;"><span style="font-weight:600;">391</span> of those records contain non-blocking warnings that will be recorded.<br><span style="font-weight:700;color:#a30052;">128</span> records are expected to be held for review: 117 possible duplicates · 11 blocked. Held records are never written silently.</div>
<div style="font-size:13px;color:#6b6866;margin-top:16px;">Dry run DR-000214 · 3:41 PM · landing snapshot LS-8841 (fingerprint a3f2…c91) · configuration v7 · mapping/rules v12 · Re-run</div>
```
Followed by integration / dry-run provenance (+ Re-run link) / environment facts, then ONE primary button ("Execute migration" / "Activate integration"). No dialog, no type-the-name ceremony — idempotency + resume earn the light ceremony.

### Migration completion ledger
```html
<div style="display:grid;grid-template-columns:auto 1fr;gap:12px 28px;font-size:15px;">
  <span style="font-weight:600;text-align:right;">18,421</span><span>source records</span>
  <span style="font-weight:600;text-align:right;">18,421</span><span>processed</span>
  <span style="font-weight:600;text-align:right;">18,293</span><span>applied</span>
  <span style="font-weight:600;text-align:right;">391</span><span>of the applied carry recorded warnings</span>
  <span style="font-weight:700;text-align:right;color:#a30052;">128</span><span>exceptions held</span>
  <span style="font-weight:600;text-align:right;">18,293</span><span>destination confirmed</span>
</div>
```
Completion is a reconciliation verdict, not a processing stop — separate timestamps for "processing finished" and the verdict. Arithmetic must be auditable: 18,421 = 18,293 applied + 128 held; warnings live inside the applied count (never 18,293 + 391 + 128); no unaccounted bucket. Only the 128 held records enter the P1 Exceptions workflow (117 Identity, 11 External Rejection); the 391 applied-with-warnings are run/reconciliation evidence, with KDX-D10 pending states for resolutions.

### 375 monitoring row
```html
<div style="padding:14px 0;border-bottom:1px solid #dedcdb;display:flex;justify-content:space-between;align-items:baseline;min-height:44px;box-sizing:border-box;">
  <span style="font-size:15px;font-weight:600;">Exceptions held</span>
  <span style="font-size:14px;font-weight:700;color:#a30052;">6</span>
</div>
```
Complex configuration renders read-only with "Best configured on a larger screen." — capability never silently removed.
