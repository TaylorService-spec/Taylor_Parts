# KEYSTONE DATA EXCHANGE (KDX) — NORTH STAR P1v2 DESIGN HANDOFF
Self-contained handoff for an external assistant (no project file access required). Everything needed to understand, critique, or implement the P1 core control plane is in this document.


## 0. P1v2 CORRECTNESS AMENDMENTS (binding — supersede anything below that conflicts)
1. Flagship operational example is CRM Sync (Inbound, CRM → Service Platform, Healthy). Integration detail is inbound (↓ path).
2. CRM ↔ Service Platform (Bidirectional) and Vendor API Export (Outbound) render UNAVAILABLE structural slots — "activation unavailable until outbound synchronization is certified." Never active traffic, health, or write-back. Overview has an "Awaiting certification" section naming both.
3. Conflict resolution offers ONLY: retain source value / retain destination value / decide later. NO "Enter another value." If neither value is correct, the operator corrects the authoritative system and KDX ingests it.
4. Conflict copy: "The chosen value becomes the canonical resolution and is recorded to the audit trail; propagation follows each connection's certified capabilities." Never "written to both systems."
5. Product rule: resolution → reprocess record → recompute reconciliation → update run result, automatically (no separate Reconcile button). Until the chain is certified, render "Resolution recorded · Reconciliation pending" / "Decision recorded · Reprocessing pending."
6. Resolved exceptions: 90-day inbox history window; older ones discoverable via governed audit history (inbox window ≠ audit retention).
7. Connection actions are capability-driven: render only actions/counters the connector declares. Webhook ingress: no Test connection — ingress-delivery evidence instead. REST: Test supported.
8. Retry timing: "Automatic retry scheduled" unless the runtime provides a real next-retry timestamp.
9. Environment badge: "SANDBOX · NOT CERTIFIED" (certification is NOT AUTHORIZED); "LOCAL" for local implementation frames; plain SANDBOX only after real certification; production banner rule unchanged.
10. Named operators are fictional fixtures; no production authentication implied. Neutrality rule: no real customer- or product-specific names, rules, mappings, or assumptions; neutral fictional fixtures permitted.
11. Overview headline sentence always agrees with the counts (e.g. "3 items need attention" — never "All systems operational" alongside a non-zero attention count).
12. Overview census: 7 integrations · 2 need attention · 2 awaiting certification. Open product-policy questions: zero (Q1/Q2/Q3 closed as above).

## 1. Product
KDX is a customer-agnostic integration, ETL, migration, synchronization, reconciliation, and data-exchange platform (owner: Project Keystone). Positioning: "a calm control center for moving important business data safely between systems." Not a developer console, not a BI dashboard. Primary user: operations / systems administrator. Primary target 1440px desktop; 1024/375 responsive views planned in P3.

All data in the design is fictional and neutral: tenant "Northwind Services"; systems CRM, Accounting, Inventory, Service Platform, Vendor API. No customer names may ever appear.

## 2. Backend ground truth (design may not exceed this)
COMPLETE: architecture, inbound ETL, migration, persistence, run orchestration, training, docs.
PASS: dry run, identity, idempotency, loop prevention, conflict resolution, tenant isolation, reconciliation, exception handling. 25/25 automated tests.
PARTIAL: outbound, bidirectional, admin UX, connectors, recovery/resume.
NOT AUTHORIZED: sandbox certification.
Capabilities that exist and may be surfaced: integrations, runs, raw landing records, mappings, validation, identity matching, cross-references, dry runs, classification, retries, exceptions, audit, schedules, reconciliation, pause/resume, CSV/XLSX/JSON, REST inbound, webhook ingress, adapter boundary, field-level authority, conflict handling.
Rule: never invent a read, action, or state the backend lacks. Missing capability = keep the structural slot, render an honest disabled/unavailable state with a one-line reason.

## 3. Visual system (Broadsheet)
- Ground #f3f2f2, ink #201e1d. Accent cyan #0088b0 (interactive, running, informational). Accent-2 magenta #d6006c deep steps (attention, exceptions). Neutrals from a 100–900 ramp.
- Typeface: Source Serif 4 everywhere — the serif IS the UI chrome; no sans-serif.
- No boxes, no borders, no dividers for layout; hierarchy from type scale + whitespace only. Cards only for genuinely discrete items (used once: Connections). Tables (themed header, hairline row rules) for runs, records, integrations, mappings, audit.
- Status is word-first: the word always prints; color reinforces, never carries alone.
- Small caps letter-spaced kickers (10.5px, .16em) label sections; big serif numerals (30–36px) carry counts.
- Buttons: solid cyan primary, outlined secondary, ghost tertiary. Radius 2px. Airy 1.25× spacing.

## 4. Application shell
Left rail, 236px, whitespace-separated (no border):
- Brand: "Keystone Data Exchange" / "KDX".
- Nav (grouped IA — decision KDX-D1): Overview · DATA EXCHANGE (Integrations, Connections, Mappings, Schedules) · OPERATIONS (Runs, Exceptions, Reconciliation) · GOVERNANCE (Audit, Administration). Active item: cyan + bold.
- Rail bottom, always visible: TENANT (Northwind Services), ENVIRONMENT (the word SANDBOX or PRODUCTION, bold, letter-spaced — production additionally gets a content-top banner, never color-only), current user ("R. Calloway · Operator").
Content column: 48–64px padding, 42px serif page title, one-line status subhead.

## 5. Status vocabulary (binding)
Integration health: Healthy · Running · Attention · Paused · Disabled · Failed · Setup Required.
Run results: Queued · Running · Paused · Reconciling · Reconciled · Reconciled with Exceptions · Partial · Failed · Cancelled.
Exception categories: Identity · Conflict · Validation · Relationship · External Rejection · Connector.
Connection states: Connected · Degraded · Disconnected · Credentials Expired · Testing.
Record operations: Create · Update · Link · No Change · Conflict · Failed.
Color mapping: Running/Reconciling = cyan-700; Attention/exception counts/Reconciled with Exceptions = magenta-700; Failed/Rejected = magenta-800; Healthy/Reconciled/Paused = ink or neutral-600/700. Word always present.

## 6. The ten P1 frames

### 01 Overview (control center)
Decision answered: "is anything wrong, and where do I go?" (<10-second read).
- H1 "Data Exchange"; subhead "All systems operational · date · time" — sentence is computed and flips to "N integrations need attention" whenever the attention count is non-zero; sentence and counts can never disagree.
- Four flush-left metrics: 6 ACTIVE INTEGRATIONS · 2 RUNNING NOW (cyan) · 14 COMPLETED TODAY · 3 NEED ATTENTION (magenta).
- Needs attention: one row per item — name + direction, one factual sentence (what happened, what's affected), status word, single action link (Review/Renew). Examples: Accounting Sync (2 identity exceptions, last success 18 min ago), Vendor API Export (credentials expire in 3 days), Legacy Orders Import (1 blocked record, paused by J. Whitfield Aug 28).
- Active work: Customer Migration · Running · thin cyan progress bar · "42,881 of 91,204 records · 47%" · started 10:42 AM. No ETA (KDX-D7: backend supports no reliable estimate).
- Recent runs table: Run / Integration / Direction / Started / Duration / Processed (right-aligned) / Result. 5 rows, IDs RUN-001823..27.
- Two closing columns: Exceptions ("3 need review — 2 identity matches, 1 external rejection") and Reconciliation last 24h ("99.99% reconciled — 182,410 processed, 182,397 reconciled, 13 exceptions"; percentage is derived, 100.00% never prints unless counts literally match).

### 02 Integrations collection
Header + primary button "New integration". Shallow filter bar: search input + single-select status chips (All/Attention/Running/Paused) + direction + system. Table columns: Integration (name links to detail; "source · target" small beneath) / Mode (Import·Inbound·Outbound·Bidirectional) / Health / Last successful run (deliberately the last SUCCESS, not last attempt — KDX-D6) / Next / Exceptions (right, magenta when >0).
Rows: CRM ↔ Service Platform (Bidirectional, Healthy, 3 min ago, Continuous, 0) · Accounting Sync (Inbound, Attention, 18 min, 3:45 PM, 2) · Inventory Feed (Inbound, Healthy, 12 min, 4:00 PM, 0) · Vendor API Export (Outbound, Attention, 1 hr, 4:15 PM, 0) · Customer Migration (Import, Running, —, —, 0) · Legacy Orders Import (Import, Paused, Aug 28, —, 1).

### 03 Integration detail — Overview tab
Breadcrumb; H1 "CRM ↔ Service Platform"; "Bidirectional · Healthy". Actions: Run now (primary) · Dry run (secondary — safe by definition, no destination writes) · Pause (ghost; confirms only if a run is in flight) · Edit (ghost; routes to Configuration tab, never a modal). No Delete here; disable lives in Configuration.
Tabs: Overview · Mappings · Runs · Exceptions · Reconciliation · Configuration.
Three-column band: CONNECTION PATH (typographic "CRM ↕ Keystone Data Exchange ↕ Service Platform", cyan arrows — never a node editor, KDX-D3: topology is constant by architecture) · HEALTH (Healthy; last successful sync 3 minutes ago; last failure none in 7 days) · TODAY (12,841 processed / 12,839 reconciled / 2 exceptions + Review link).
Second band: Data authority (four rows: Customer name→Service Platform, External account ID→CRM, Billing terms→Accounting, Customer owner→Service Platform; link "All 42 fields"; meaning: when both systems change the field, the named system's value is retained) · Schedule (Every 15 minutes; next 3:30 PM; last 3:15 PM — Reconciled with Exceptions) · Recent activity (4 compact timestamped lines incl. a conflict-resolved-by-user entry).

### 04 Runs collection
Header "Runs — 14 completed today · 2 running · 1 with exceptions". Filters: search, Today/7 days, integration, result. Same table columns as Overview's recent-runs. 9 rows spanning the vocabulary: Running · 47% (migration, processed 42,881) · Reconciling · Reconciled with Exceptions · Reconciled ×4 · "Partial — resumable" (Legacy Orders Import, "2,183 of 7,411", 11m 26s). Footnote contract line: partial runs keep saved progress; the resumable badge prints only when the run's checkpoint is intact (recovery is PARTIAL on the backend).

### 05 Run detail (RUN-001827)
Kicker "CRM SYNC · INBOUND"; H1 "RUN-001827"; status "Reconciled with Exceptions" in magenta (a terminal, honest state — ledger balanced for 2,408, 3 individually accounted for; not a failure, not clean). Right-aligned: Started 3:15:02 PM · Completed 3:16:44 PM · Duration 1m 42s.
Tabs: Summary · Records · Exceptions · Reconciliation · Audit.
PIPELINE — six typographic stages with arrows, each a real orchestration counter: Received 2,411 → Validated 2,411 → Matched 2,408 → Applied 2,408 → Exceptions 3 (magenta) → Reconciled 2,408. Arithmetic auditable by eye: 2,411 − 3 = 2,408 at every later stage.
Results: Create 102 · Update 2,201 · Link 105 · No change 0 · Conflict 2 (magenta) · Failed — external rejection 1 (magenta).
Exceptions in this run: three linked rows (2 authority conflicts: Customer/23819, Customer/24102; 1 external rejection: Customer/28377). Contract copy: resolving all three re-runs reconciliation automatically; result updates to Reconciled once the ledger balances (open question KDX-Q2).
Running-job variant (specified, not framed): progress, current stage, processed count, errors, Pause. No ETA.

### 06 Reconciliation detail
Designed as proof, not status. Left ledger column: SOURCE 2,411 records received ↓ KEYSTONE DATA EXCHANGE 2,411 processed / 2,408 applied / 3 exceptions ↓ DESTINATION 2,408 confirmed. Right: RESULT "Reconciled with Exceptions", "99.88% confirmed of received"; Discrepancies: 2 authority conflicts (held pending review) + 1 external rejection (destination refused the write); line: all 3 are in the Exceptions inbox, none of the 2,408 confirmed records has an unexplained difference. No "unaccounted" bucket may exist.
Record-level evidence table: Source record / Transformation / KDX operation / Destination result. Rows: CUST-23819 ACME Food Services · 27 fields mapped, name normalized · Update — held · Not applied, authority conflict pending review; CUST-24102 Meridian Operations LLC (same held pattern); CUST-28377 Alpine Equipment Co. · region inferred · Create · Rejected — destination requires region code; two confirmed rows with timestamps. Link "All 2,411 records". A record must be traceable source → transformation → operation → destination without opening logs.

### 07 Exceptions inbox
H1 "Exceptions"; "3 need review (magenta) · 12 resolved this week". The inbox holds ONLY records waiting on human judgment — retryable failures stay in the run ledger and retry themselves. Filter chips with counts: Needs review 3 · Identity 2 · Conflict 2 · External rejection 1 · Resolved.
Row anatomy: magenta category kicker (IDENTITY / CONFLICT / EXTERNAL REJECTION), linked title, one fact line (system, record, evidence, detection time, retry-safety), secondary Review button. Rows: "Possible duplicate customer" (CRM, Customer #28391, ACME Food Services, 2 possible matches, 4 min ago) · "Both systems changed Customer name" (Customer/23819, authority Manual review, 7 min ago) · "Destination refused the write" (Customer/28377, "Region code is required", safe to retry after correction).
Bulk ops only where provably safe (retry external rejections after a fix); identity and conflict always one at a time (KDX-D4). Empty state: "No exceptions — there are no records waiting for review." No celebration UI.

### 08 Exception detail — identity / possible duplicate
Kicker "IDENTITY · NEEDS REVIEW"; H1 "Possible duplicate customer"; provenance line (CRM Sync · RUN-001827 · detected 3:16 PM).
Left: INCOMING RECORD · CRM — ACME Food Services, Phoenix AZ, External ID 28391, billing email, owner.
Right: POSSIBLE MATCHES IN SERVICE PLATFORM — ACME Food Service (Phoenix, since 2021, 214 orders) 87% confidence; ACME Foods (Tempe, since 2019, 48 orders) 61% confidence. Confidence is evidence, never an auto-decision; no threshold silently merges.
Actions: Link to existing (primary) · Create new (secondary) · Ignore (ghost). Contract copy: the decision is recorded to the audit trail, applies a cross-reference, and the record re-processes automatically.

### 09 Conflict resolution — manual-review path
Kicker "CONFLICT · MANUAL REVIEW REQUIRED"; H1 "Customer name changed in both systems"; line naming the field's configured authority: Manual review. (Other path: when a field has a system authority, NO exception is raised — the authority value is retained and the run notes it.)
Side-by-side values first, provenance second: CRM "ACME FOOD SERVICE" (changed 2:58 PM by jortiz) vs Service Platform "Acme Food Services" (changed 3:04 PM by S. Whitcomb).
CHOOSE THE VALUE TO KEEP — three radios: CRM value / Service Platform value (pre-selected) / "Enter another value" (open question KDX-Q1). Copy: "The chosen value will be written to both systems on the next sync. This decision is recorded to the audit trail." Actions: Resolve conflict (primary) · Decide later (ghost).

### 10 Connections
The one card collection (discrete items with per-item actions — KDX-D8). Header contract line: "Credential state is shown, never credential contents." Primary: New connection.
Four cards (kicker = connector type, title, state fact lines, action links):
- Production CRM · REST API · Connected · last checked 2 min ago · used by 3 integrations · Test/Edit/Disable.
- Accounting · Application Adapter · "Credentials expire in 3 days" (magenta) · used by 1 · runs continue until expiry · Renew credentials/Test/Edit.
- Service Platform · Application Adapter · Connected · used by 5 · Test/Edit/Disable.
- Vendor API · Webhook ingress · Degraded (magenta) · "2 of 14 probes failed in the last hour" · automatic retry in 3 minutes · Test connection/Edit.
"Last checked" is the health-probe timestamp, not the last run. Disable warns with the count of integrations that would stop.

## 7. Named design decisions
KDX-D1 grouped IA · KDX-D2 word-first status vocabulary · KDX-D3 typographic connection path, never a node editor · KDX-D4 identity/conflict resolved singly, bulk only for provably safe retries · KDX-D5 environment as a word in a fixed rail slot (+production banner), never color-only · KDX-D6 collections show last SUCCESSFUL run · KDX-D7 no ETAs, records-based progress only · KDX-D8 cards only for Connections, tables elsewhere.

## 8. Gaps (truthful, not designed around)
KDX-G1 sandbox certification NOT AUTHORIZED — badge reflects sandbox honestly. KDX-G2 outbound/bidirectional PARTIAL — unreal capabilities render disabled with a one-line reason, slot preserved. KDX-G3 recovery PARTIAL — "resumable" prints only with intact checkpoint. KDX-G4 connectors PARTIAL — picker lists only real connectors (CSV/XLSX, JSON, REST, Webhook, Application Adapter). KDX-G5 admin UX PARTIAL — Administration page deferred to P3 against real controls only.

## 9a. Open product-policy questions
KDX-Q1 — may conflict resolution write a third, operator-entered value to both systems, or only choose between the two? (Designed as permitted.)
KDX-Q2 — does resolving all of a run's exceptions auto-re-run reconciliation (designed as yes) or require explicit action?
KDX-Q3 — retention window for resolved exceptions in the inbox's Resolved filter?

## 10. Reusable component templates
Every P1 frame is composed from these templates; reuse them verbatim across the product.
- **Shell / rail** — 236px left rail: brand block, grouped nav (small-caps group kickers, cyan+bold active item), bottom context stack (TENANT / ENVIRONMENT / user). Fixed on every page.
- **Page header** — 42px serif H1 + one-line computed status subhead; optional right-aligned primary button.
- **Environment badge** — the word SANDBOX/PRODUCTION, bold, .06em letter-spacing, in the rail slot; production adds a content-top banner.
- **Metric** — flush-left big numeral (30–36px) over a small-caps label; no card, no box. Magenta numeral when the count demands attention, cyan when running.
- **Status word** — 12.5px, weight 600–700, colored per §5; always adjacent to its noun.
- **Data table** — Broadsheet `.table`: themed header, hairline row rules, right-aligned numerics, linked primary cell with small "source · target" subline.
- **Filter bar** — search input + single-select chips (cyan-filled = active, outline = idle); max four filter groups.
- **Attention row** — name + direction, one factual sentence, status word, single action link (Overview, Exceptions inbox).
- **Progress bar** — 4px track (neutral-200) with cyan fill + "X of Y records · N%" line; never an ETA.
- **Pipeline** — typographic stage counters with → separators; exception stage in magenta.
- **Reconciliation ledger** — SOURCE ↓ KDX ↓ DESTINATION stacked counts with cyan arrows, RESULT column beside.
- **Exception row** — magenta category kicker, linked title, fact line, secondary Review button.
- **Comparison (conflict)** — two value columns (value large, provenance small beneath), radio group to choose, primary Resolve.
- **Connection card** — the one `.card` use: type kicker, name, state fact lines, inline action links.
- **Action row** — primary / secondary / ghost button ranking per KDX-D-series safety rules.
- **Empty state** — one sentence of fact + one action ("No integrations yet… [New integration]"); no illustration, no celebration.
- **Failure state** — what happened, what's affected, saved progress, next automatic step, one manual action ("[Resume run]", "[Test connection]").
- **Hover annotation** — 16px circled-i with ~380px dark tooltip; design rationale only, never product content.
Still to be templated in P2/P3: mapping row (source→destination with transform/state), authority selector, wizard stepper, confirmation dialog, side detail panel, activity timeline.

## 11. Responsive / mobile templates
Mobile frames are P3 scope — not yet drawn. The binding behavior, so nothing is improvised later:
- **1440 (primary)** — as framed. Desktop experience is never degraded for parity.
- **1024 tablet** — rail collapses to a 64px icon rail (labels on hover/tap), same grouped IA; content columns drop from 2–3 to 1–2; tables keep all columns with horizontal scroll only if unavoidable.
- **375 mobile (monitoring posture)** — supports monitoring, viewing runs, reviewing exceptions, basic resolution. Rail becomes a top bar + sheet menu; tenant/environment words stay persistently visible in the top bar. Tables restack to key-value rows: primary line (name + status word), second line (the row's one deciding fact), counts right-aligned. Pipeline stacks vertically. Exception review and conflict resolution work full-screen, one decision per screen, 44px minimum hit targets.
- **Desktop-recommended** — mapping configuration, field authority, and the migration wizard render a notice on 375 ("Best configured on a larger screen") with read-only viewing; never silently drop capability.

## 12. Coverage
COMPLETE: Overview, Integrations, Integration Detail (Overview tab), Connections, Runs, Run Detail, Exceptions, Exception Detail, Conflict Resolution, Reconciliation.
NOT STARTED (P2): new-integration wizard (Connection→Direction→Data→Mapping→Rules→Validate→Activate), migration upload/inspection, field mapping, field authority, validation, dry-run impact review, execute confirmation, migration running/completed.
NOT STARTED (P3): Schedules, Audit, Administration, dedicated failure/empty-state frames, production-safety frames, 1024/375 responsive views.
PARTIAL: failure/recovery and empty states (copy specified inline on P1 frames).


## 13. Component template HTML
Copy-pasteable reference markup. Token values are inlined (ground #f3f2f2, ink #201e1d, cyan #0088b0 / dark step #006a8a, magenta dark step #a30052 / darker #7d003f, neutrals #4a4846 / #6b6866 / #8a8785 / #b5b2b0 / #dedcdb). Font is Source Serif 4 everywhere. Radius 2px.

### Shell + rail
```html
<body style="margin:0;background:#f3f2f2;color:#201e1d;font-family:'Source Serif 4',Georgia,serif;">
<div style="display:grid;grid-template-columns:236px 1fr;min-height:100vh;">
  <aside style="padding:44px 30px;display:flex;flex-direction:column;gap:38px;">
    <div>
      <div style="font-size:19px;font-weight:700;letter-spacing:-0.01em;">Keystone Data Exchange</div>
      <div style="font-size:11px;letter-spacing:.18em;color:#6b6866;margin-top:4px;">KDX</div>
    </div>
    <nav style="display:flex;flex-direction:column;gap:28px;font-size:15px;">
      <a href="#" style="color:#006a8a;font-weight:700;text-decoration:none;">Overview</a>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">DATA EXCHANGE</div>
        <a href="#" style="color:#4a4846;text-decoration:none;">Integrations</a>
        <a href="#" style="color:#4a4846;text-decoration:none;">Connections</a>
        <a href="#" style="color:#4a4846;text-decoration:none;">Mappings</a>
        <a href="#" style="color:#4a4846;text-decoration:none;">Schedules</a>
      </div>
      <!-- OPERATIONS: Runs, Exceptions, Reconciliation · GOVERNANCE: Audit, Administration -->
    </nav>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:14px;">
      <div>
        <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">TENANT</div>
        <div style="font-size:14px;font-weight:600;margin-top:3px;">Northwind Services</div>
      </div>
      <div>
        <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">ENVIRONMENT</div>
        <div style="font-size:14px;font-weight:700;margin-top:3px;letter-spacing:.06em;">SANDBOX</div>
      </div>
      <div style="font-size:12.5px;color:#6b6866;">R. Calloway · Operator</div>
    </div>
  </aside>
  <main style="padding:48px 64px 56px 56px;display:flex;flex-direction:column;gap:52px;"><!-- page --></main>
</div>
</body>
```

### Page header (+ primary action)
```html
<header style="display:flex;justify-content:space-between;align-items:flex-end;">
  <div>
    <h1 style="margin:0;font-size:42px;font-weight:600;letter-spacing:-0.015em;">Integrations</h1>
    <div style="font-size:15px;color:#4a4846;margin-top:6px;">6 active · 2 need attention · 1 paused</div>
  </div>
  <button style="font:600 15px 'Source Serif 4',serif;background:#0088b0;color:#fff;border:0;border-radius:2px;padding:10px 20px;cursor:pointer;">New integration</button>
</header>
```

### Buttons (ranking)
```html
<button style="font:600 15px 'Source Serif 4',serif;background:#0088b0;color:#fff;border:0;border-radius:2px;padding:10px 20px;cursor:pointer;">Run now</button>
<button style="font:600 15px 'Source Serif 4',serif;background:transparent;color:#006a8a;border:1px solid #0088b0;border-radius:2px;padding:9px 19px;cursor:pointer;">Dry run</button>
<button style="font:600 15px 'Source Serif 4',serif;background:transparent;color:#4a4846;border:0;border-radius:2px;padding:10px 14px;cursor:pointer;">Pause</button>
```
Hover: darken one step (#006a8a fill / cyan-tinted background for outlined and ghost). Focus: `outline:2px solid #0088b0;outline-offset:2px;`.

### Production environment banner (top of content, in addition to rail word)
```html
<div style="font-size:13.5px;font-weight:700;letter-spacing:.1em;color:#7d003f;padding:10px 0;">PRODUCTION ENVIRONMENT — changes affect live destination data</div>
```

### Metric group
```html
<div style="display:flex;gap:72px;">
  <div><div style="font-size:36px;font-weight:600;">6</div><div style="font-size:11px;letter-spacing:.14em;color:#6b6866;margin-top:2px;">ACTIVE INTEGRATIONS</div></div>
  <div><div style="font-size:36px;font-weight:600;color:#006a8a;">2</div><div style="font-size:11px;letter-spacing:.14em;color:#6b6866;margin-top:2px;">RUNNING NOW</div></div>
  <div><div style="font-size:36px;font-weight:600;color:#a30052;">3</div><div style="font-size:11px;letter-spacing:.14em;color:#6b6866;margin-top:2px;">NEED ATTENTION</div></div>
</div>
```

### Status word
```html
<span style="font-size:12.5px;font-weight:700;color:#a30052;">Attention</span>
<span style="font-size:12.5px;font-weight:600;color:#006a8a;">Running</span>
<span style="font-size:12.5px;font-weight:600;">Healthy</span>
<span style="font-size:12.5px;font-weight:600;color:#6b6866;">Paused</span>
```

### Data table
```html
<table style="border-collapse:collapse;width:100%;max-width:1080px;font-size:14.5px;">
  <thead>
    <tr style="text-align:left;">
      <th style="font-size:11px;letter-spacing:.12em;color:#6b6866;font-weight:600;padding:0 16px 10px 0;border-bottom:1px solid #b5b2b0;">RUN</th>
      <th style="font-size:11px;letter-spacing:.12em;color:#6b6866;font-weight:600;padding:0 16px 10px 0;border-bottom:1px solid #b5b2b0;">INTEGRATION</th>
      <th style="font-size:11px;letter-spacing:.12em;color:#6b6866;font-weight:600;padding:0 16px 10px 0;border-bottom:1px solid #b5b2b0;text-align:right;">PROCESSED</th>
      <th style="font-size:11px;letter-spacing:.12em;color:#6b6866;font-weight:600;padding:0 0 10px 0;border-bottom:1px solid #b5b2b0;">RESULT</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;"><a href="#" style="color:#006a8a;font-weight:600;text-decoration:none;">RUN-001827</a></td>
      <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;">CRM Sync<div style="font-size:12.5px;color:#6b6866;">CRM → Service Platform</div></td>
      <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;text-align:right;">2,411</td>
      <td style="padding:12px 0;border-bottom:1px solid #dedcdb;font-weight:600;color:#a30052;">Reconciled with Exceptions</td>
    </tr>
  </tbody>
</table>
```

### Filter bar
```html
<div style="display:flex;gap:16px;align-items:center;">
  <input placeholder="Search integrations" style="font:15px 'Source Serif 4',serif;padding:9px 12px;border:1px solid #b5b2b0;border-radius:2px;background:#fff;width:280px;">
  <div style="display:flex;gap:8px;">
    <span style="font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:2px;background:#0088b0;color:#fff;">All statuses</span>
    <span style="font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:2px;border:1px solid #b5b2b0;color:#4a4846;">Attention</span>
    <span style="font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:2px;border:1px solid #b5b2b0;color:#4a4846;">Running</span>
  </div>
</div>
```

### Attention row
```html
<div style="display:grid;grid-template-columns:1fr auto auto;gap:24px;align-items:baseline;max-width:880px;">
  <div>
    <span style="font-weight:600;font-size:16px;">Accounting Sync</span>
    <span style="font-size:12.5px;color:#6b6866;">Inbound</span>
    <div style="font-size:13.5px;color:#4a4846;margin-top:2px;">2 records need review — identity matches. Last successful sync 18 min ago.</div>
  </div>
  <span style="font-size:12.5px;font-weight:700;color:#a30052;">Attention</span>
  <a href="#" style="font-size:14px;font-weight:600;color:#006a8a;text-decoration:none;">Review</a>
</div>
```

### Progress bar (no ETA)
```html
<div style="max-width:880px;">
  <div style="height:4px;background:#dedcdb;"><div style="height:4px;width:47%;background:#0088b0;"></div></div>
  <div style="display:flex;justify-content:space-between;font-size:13.5px;color:#4a4846;margin-top:8px;">
    <span>42,881 of 91,204 records</span><span>47%</span>
  </div>
</div>
```

### Pipeline
```html
<div style="display:flex;align-items:baseline;gap:28px;flex-wrap:wrap;">
  <div><div style="font-size:30px;font-weight:600;">2,411</div><div style="font-size:11px;letter-spacing:.12em;color:#6b6866;">RECEIVED</div></div>
  <div style="font-size:20px;color:#b5b2b0;">→</div>
  <div><div style="font-size:30px;font-weight:600;">2,408</div><div style="font-size:11px;letter-spacing:.12em;color:#6b6866;">APPLIED</div></div>
  <div style="font-size:20px;color:#b5b2b0;">→</div>
  <div><div style="font-size:30px;font-weight:600;color:#a30052;">3</div><div style="font-size:11px;letter-spacing:.12em;color:#6b6866;">EXCEPTIONS</div></div>
</div>
```

### Reconciliation ledger
```html
<section style="max-width:420px;">
  <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">SOURCE</div>
  <div style="font-size:24px;font-weight:600;margin-top:6px;">2,411 <span style="font-size:15px;font-weight:400;color:#4a4846;">records received</span></div>
  <div style="font-size:22px;color:#0088b0;margin:14px 0 14px 8px;">↓</div>
  <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">KEYSTONE DATA EXCHANGE</div>
  <div style="font-size:15px;line-height:1.9;margin-top:6px;"><span style="font-size:24px;font-weight:600;">2,408</span> applied<br><span style="font-size:24px;font-weight:700;color:#a30052;">3</span> exceptions</div>
  <div style="font-size:22px;color:#0088b0;margin:14px 0 14px 8px;">↓</div>
  <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">DESTINATION</div>
  <div style="font-size:24px;font-weight:600;margin-top:6px;">2,408 <span style="font-size:15px;font-weight:400;color:#4a4846;">confirmed</span></div>
</section>
```

### Exception row
```html
<div style="display:grid;grid-template-columns:1fr auto;gap:24px;align-items:start;max-width:960px;">
  <div>
    <div style="font-size:12px;letter-spacing:.12em;color:#a30052;font-weight:700;">IDENTITY</div>
    <div style="font-size:18px;font-weight:600;margin-top:4px;"><a href="#" style="color:#006a8a;text-decoration:none;">Possible duplicate customer</a></div>
    <div style="font-size:14px;color:#4a4846;margin-top:4px;">CRM · Customer #28391 · 2 possible matches · Detected 4 minutes ago</div>
  </div>
  <button style="font:600 14px 'Source Serif 4',serif;background:transparent;color:#006a8a;border:1px solid #0088b0;border-radius:2px;padding:7px 16px;cursor:pointer;">Review</button>
</div>
```

### Conflict comparison + choice
```html
<div style="display:grid;grid-template-columns:1fr 1fr;gap:80px;max-width:960px;">
  <section>
    <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">CRM</div>
    <div style="font-size:26px;font-weight:600;margin-top:10px;">ACME FOOD SERVICE</div>
    <div style="font-size:13px;color:#6b6866;margin-top:10px;">Changed today 2:58 PM · by jortiz</div>
  </section>
  <section>
    <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">SERVICE PLATFORM</div>
    <div style="font-size:26px;font-weight:600;margin-top:10px;">Acme Food Services</div>
    <div style="font-size:13px;color:#6b6866;margin-top:10px;">Changed today 3:04 PM · by S. Whitcomb</div>
  </section>
</div>
<div style="display:flex;flex-direction:column;gap:14px;font-size:16px;margin-top:24px;">
  <label style="display:flex;gap:10px;align-items:center;"><input type="radio" name="cval" style="accent-color:#0088b0;">ACME FOOD SERVICE <span style="font-size:12.5px;color:#6b6866;">— CRM</span></label>
  <label style="display:flex;gap:10px;align-items:center;"><input type="radio" name="cval" checked style="accent-color:#0088b0;">Acme Food Services <span style="font-size:12.5px;color:#6b6866;">— Service Platform</span></label>
  <label style="display:flex;gap:10px;align-items:center;"><input type="radio" name="cval" style="accent-color:#0088b0;">Enter another value</label>
</div>
```

### Connection card (the one card use)
```html
<div style="background:#fff;border-radius:2px;box-shadow:0 1px 3px rgba(32,30,29,.12);padding:24px;width:480px;">
  <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">REST API</div>
  <div style="font-size:20px;font-weight:600;margin-top:6px;">Production CRM</div>
  <div style="font-size:14.5px;color:#4a4846;margin-top:10px;line-height:1.7;"><span style="font-weight:600;color:#201e1d;">Connected</span> · Last checked 2 min ago<br>Used by 3 integrations</div>
  <div style="display:flex;gap:16px;margin-top:16px;">
    <a href="#" style="font-size:14px;font-weight:600;color:#006a8a;text-decoration:none;">Test</a>
    <a href="#" style="font-size:14px;font-weight:600;color:#006a8a;text-decoration:none;">Edit</a>
    <a href="#" style="font-size:14px;font-weight:600;color:#006a8a;text-decoration:none;">Disable</a>
  </div>
</div>
```

### Empty state
```html
<div style="max-width:520px;">
  <div style="font-size:22px;font-weight:600;">No integrations yet</div>
  <div style="font-size:15px;color:#4a4846;margin-top:8px;">Connect a source and destination to start moving data through Keystone Data Exchange.</div>
  <button style="font:600 15px 'Source Serif 4',serif;background:#0088b0;color:#fff;border:0;border-radius:2px;padding:10px 20px;margin-top:20px;cursor:pointer;">New integration</button>
</div>
```

### Failure state (durable resume)
```html
<div style="max-width:520px;">
  <div style="font-size:12px;letter-spacing:.12em;color:#a30052;font-weight:700;">RUN STOPPED</div>
  <div style="font-size:22px;font-weight:600;margin-top:4px;">Connection failed mid-run</div>
  <div style="font-size:15px;color:#4a4846;margin-top:8px;line-height:1.7;">2,183 of 7,411 records were processed before the connection failed.<br><span style="font-weight:600;color:#201e1d;">Progress has been saved.</span> Automatic retry in 3 minutes.</div>
  <button style="font:600 15px 'Source Serif 4',serif;background:#0088b0;color:#fff;border:0;border-radius:2px;padding:10px 20px;margin-top:20px;cursor:pointer;">Resume run</button>
</div>
```

### Mobile restack (375 — key-value row replacing a table row)
```html
<div style="padding:14px 16px;border-bottom:1px solid #dedcdb;">
  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;">
    <span style="font-weight:600;font-size:16px;">Accounting Sync</span>
    <span style="font-size:12.5px;font-weight:700;color:#a30052;">Attention</span>
  </div>
  <div style="font-size:13.5px;color:#4a4846;margin-top:3px;">2 records need review · last success 18 min ago</div>
</div>
```
Mobile top bar keeps tenant + environment words visible; all touch targets >=44px.
