# KEYSTONE DATA EXCHANGE — NORTH STAR P1v4
Single authoritative implementation handoff for Codex. Final fixture reconciliation applied: one integration census, one exception dataset, reconciled run arithmetic, endpoint-local authority, the approved conflict wording, and the full environment model — consistent across prose, frames, and every HTML template. Rendered frames: the three "KDX North Star P1v2 - *.dc.html" canvas files (updated in place to this fixture).

## 1. Product
KDX is a customer-agnostic integration, ETL, migration, synchronization, reconciliation, and data-exchange platform (owner: Project Keystone). Positioning: "a calm control center for moving important business data safely between systems." Not a developer console, not a BI dashboard. Primary user: operations / systems administrator. Primary target 1440px desktop; 1024/375 responsive views planned in P3.

All data in the design is fictional and neutral: tenant "Northwind Services"; systems CRM, Accounting, Inventory, Service Platform, Vendor API. No real customer-specific or product-specific names, rules, mappings, or assumptions may appear in KDX core design or implementation. Neutral fictional certification fixtures are permitted.

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
- Rail bottom, always visible: TENANT (Northwind Services), ENVIRONMENT (the environment-model word: LOCAL for local runtime · "SANDBOX · NOT CERTIFIED" pre-certification (current) · plain SANDBOX only after actual certification · PRODUCTION with the content-top banner — never color-only), current user ("R. Calloway · Operator").
Content column: 48–64px padding, 42px serif page title, one-line status subhead.

## 5. Status vocabulary (binding)
Integration health: Healthy · Running · Attention · Paused · Disabled · Failed · Setup Required.
Run results: Queued · Running · Paused · Reconciling · Reconciled · Reconciled with Exceptions · Partial · Failed · Cancelled.
Exception categories: Identity · Conflict · Validation · Relationship · External Rejection · Connector.
Connection states: Connected · Degraded · Disconnected · Credentials Expired · Testing.
Record operations: Create · Update · Link · No Change · Conflict · Failed.
Color mapping: Running/Reconciling = cyan-700; Attention/exception counts/Reconciled with Exceptions = magenta-700; Failed/Rejected = magenta-800; Healthy/Reconciled/Paused = ink or neutral-600/700. Word always present.
Capability vocabulary (separate from operational health — a capability that cannot run has no health): Certified · Awaiting Certification · Unavailable. Awaiting Certification prints in neutral ink in the status position of unavailable capability slots, with no health word, no successful-run timestamps, no next run, and no traffic or write-back claims.

## 6. The ten P1 frames

### 01 Overview (control center)
Decision answered: "is anything wrong, and where do I go?" (<10-second read).
- H1 "Data Exchange"; subhead "3 items need attention · Wednesday, September 2 · 3:22 PM" — the sentence is computed and must reconcile exactly with the counts; "All systems operational" prints only when the attention count is zero.
- Four flush-left metrics: 5 ACTIVE INTEGRATIONS · 2 RUNNING NOW (cyan) · 14 COMPLETED TODAY · 3 NEED ATTENTION (magenta). Census: 7 integrations · 2 integration-level attention · 2 awaiting certification. Unavailable capabilities are never counted as operational attention.
- Needs attention (3 items): Accounting Sync (3 records need review — 1 identity match, 1 authority conflict, 1 external rejection; last success 18 min ago) · Accounting connection (credentials expire in 3 days; runs continue until expiry) · Legacy Orders Import (run stopped mid-import — 2,183 of 7,411 records processed, progress saved; paused by J. Whitfield Aug 28; action: Resume). Each row: name, one factual sentence, status word, single action link.
- AWAITING CERTIFICATION section (distinct, after Needs attention): CRM ↔ Service Platform · Bidirectional · "Bidirectional setup is preserved, but activation is unavailable until outbound synchronization is certified." / Vendor API Export · Outbound · "Outbound execution is not yet certified. Configuration preserved; activation unavailable." Status word: Awaiting Certification (neutral ink).
- Active work: Customer Migration · Running · thin cyan progress bar · "42,881 of 91,204 records · 47%" · started 10:42 AM. No ETA (KDX-D7).
- Recent runs table: Run / Integration / Direction / Started / Duration / Processed (right-aligned) / Result. All rows inbound or import — no outbound run rows exist anywhere in P1. RUN-001827 (Accounting Sync · Inbound) is the single Reconciled-with-Exceptions run; the flagship CRM Sync runs are clean.
- Two closing columns: Exceptions ("3 need review — 1 identity match, 1 authority conflict, 1 external rejection") and Reconciliation last 24h ("99.99% reconciled — 182,410 processed, 182,397 reconciled, 13 exceptions"; percentage is derived; 100.00% never prints unless the counts literally match).

### 02 Integrations collection
Header + primary button "New integration". Subhead: "7 integrations · 2 need attention · 2 awaiting certification". Shallow filter bar: search + single-select status chips + direction + system. Table columns: Integration (name links to detail; "source → target" small beneath) / Mode (Import·Inbound·Outbound·Bidirectional) / Status (health word, or capability word for unavailable slots) / Last successful run (the last SUCCESS, not last attempt — KDX-D6) / Next / Exceptions (right, magenta when >0).
Rows:
- CRM Sync · CRM → Service Platform · Inbound · Healthy · 7 minutes ago · 3:30 PM · 0 — the flagship operational example.
- CRM ↔ Service Platform · Bidirectional · Awaiting Certification · — · — · 0 · subline "Activation unavailable until outbound synchronization is certified".
- Accounting Sync · Inbound · Attention · 18 minutes ago · 3:45 PM · 3 (owns the three unresolved exceptions via RUN-001827).
- Inventory Feed · Inbound · Healthy · 12 minutes ago · 4:00 PM · 0.
- Vendor API Export · Outbound · Awaiting Certification · — · — · 0 · subline "Outbound execution not yet certified".
- Customer Migration · Import · Running · — · — · 0.
- Legacy Orders Import · Import · Paused · Aug 28 · — · 0 (its open item is the resumable partial run, not an exception).
Capability vs health: an unavailable capability row carries NO operational health, no successful-run timestamps, no next run, no traffic, and no write-back claims — its status cell prints Awaiting Certification in neutral ink.

### 03 Integration detail — Overview tab
Flagship operational detail: CRM Sync. Breadcrumb; H1 "CRM Sync"; subhead "Inbound · CRM → Service Platform · Healthy". Actions: Run now (primary, routine) · Dry run (secondary — safe by definition, no destination writes) · Pause (ghost; confirms only when a run is in flight) · Edit (ghost; routes to the Configuration tab, never a modal). No Delete here; disable lives in Configuration behind its own deliberate step.
Tabs: Overview · Mappings · Runs · Exceptions · Reconciliation · Configuration.
Three-column band: CONNECTION PATH (typographic, one direction: "CRM ↓ Keystone Data Exchange ↓ Service Platform", cyan arrows — never a node editor, KDX-D3; no active bidirectional topology is displayed anywhere in P1) · HEALTH (Healthy; last successful sync 7 minutes ago; last failure none in 7 days) · TODAY (12,841 processed / 12,841 reconciled / 0 exceptions — the flagship is clean; the exception-owning integration is Accounting Sync).
Second band: Data authority (Customer name→Service Platform, External account ID→CRM, Billing email→CRM, Customer owner→Service Platform; link "All 42 fields"). Authority references are endpoint-local: only the integration’s source and destination endpoints may be named as a field authority — no third system — unless KDX’s actual authority model explicitly supports an external authority reference. These are fictional certification fixtures, not customer business policy. Meaning on the certified inbound path: when an incoming value conflicts with the destination's current value, the named system's value is retained. Authority configuration structurally covers both directions, but active behavior reflects only the certified inbound path — no write-back is implied. · Schedule (Every 15 minutes; next 3:30 PM; last 3:15 PM — Reconciled) · Recent activity (compact timestamped run and resolution lines).

### 04 Runs collection
Header "Runs — 14 completed today · 2 running · 1 with exceptions". Filters: search, Today/7 days, integration, result. Same table columns as Overview's recent-runs. 9 rows spanning the vocabulary: Running · 47% (migration, processed 42,881) · Reconciling · Reconciled with Exceptions (only RUN-001827 · Accounting Sync) · Reconciled ×5 · "Partial — resumable" (Legacy Orders Import, "2,183 of 7,411", 11m 26s). Footnote contract line: partial runs keep saved progress; the resumable badge prints only when the run's checkpoint is intact (recovery is PARTIAL on the backend).

### 05 Run detail (RUN-001827)
Kicker "ACCOUNTING SYNC · INBOUND"; H1 "RUN-001827"; status "Reconciled with Exceptions" in magenta (a terminal, honest state — ledger balanced for 2,408, 3 individually accounted for; not a failure, not clean). Right-aligned: Started 3:15:02 PM · Completed 3:16:44 PM · Duration 1m 42s.
Tabs: Summary · Records · Exceptions · Reconciliation · Audit.
PIPELINE — five typographic stages with arrows. Every displayed stage is an actual KDX runtime counter or a deterministic derivation from runtime facts; no stage exists for visual symmetry (Matched was removed on that rule — it is not a stable engine counter). Received 2,411 → Validated 2,411 → Applied 2,408 → Exceptions 3 (magenta) → Reconciled 2,408. Arithmetic auditable by eye: 2,411 − 3 = 2,408. Codex binds these counters to executable KDX facts.
Results: Create 102 · Update 2,201 · Link 105 · No change 0 · Identity — held 1 · Conflict — held 1 · Failed — external rejection 1 (held/failed in magenta). Reconciles mathematically: 102 + 2,201 + 105 + 0 + 1 + 1 + 1 = 2,411 received.
Exceptions in this run — the one authoritative dataset used on every P1 screen: Customer/28391 (Identity · possible duplicate), Customer/23819 (Conflict · name changed in both systems), Customer/28377 (External Rejection · destination requires region code). Contract copy: resolution → record reprocessing → reconciliation recomputation → run-result update is the product rule (no separate Reconcile button). Until the complete automatic chain has executable proof, the UI states "Resolution recorded · Reconciliation pending" — it never claims the next step happened before it has.
Running-job variant (specified, not framed): progress, current stage, processed count, errors, Pause. No ETA.

### 06 Reconciliation detail
Designed as proof, not status. Left ledger column: SOURCE 2,411 records received ↓ KEYSTONE DATA EXCHANGE 2,411 processed / 2,408 applied / 3 exceptions ↓ DESTINATION 2,408 confirmed. Right: RESULT "Reconciled with Exceptions", "99.88% confirmed of received"; Discrepancies: 1 identity exception (held pending review) + 1 authority conflict (held pending review) + 1 external rejection (destination refused the write); line: all 3 are in the Exceptions inbox, none of the 2,408 confirmed records has an unexplained difference. No "unaccounted" bucket may exist.
Record-level evidence table: Source record / Transformation / KDX operation / Destination result. Rows: CUST-28391 ACME Food Services · 27 fields mapped · Create — held · Not applied, possible duplicate pending review; CUST-23819 Acme Food Services · name normalized · Update — held · Not applied, authority conflict pending review; CUST-28377 Alpine Equipment Co. · region inferred · Create · Rejected — destination requires region code; two confirmed rows with timestamps. Link "All 2,411 records". A record must be traceable source → transformation → operation → destination without opening logs.

### 07 Exceptions inbox
H1 "Exceptions"; "3 need review (magenta) · 12 resolved this week". The inbox holds ONLY records waiting on human judgment — retryable failures stay in the run ledger and retry themselves. Filter chips with counts: Needs review 3 · Identity 1 · Conflict 1 · External rejection 1 · Resolved 12.
Row anatomy: magenta category kicker (IDENTITY / CONFLICT / EXTERNAL REJECTION), linked title, one fact line (system, record, evidence, detection time, retry-safety), secondary Review button. Rows: "Possible duplicate customer" (Accounting, Customer #28391, ACME Food Services, 2 possible matches, 4 min ago) · "Both systems changed Customer name" (Customer/23819, authority Manual review, 7 min ago) · "Destination refused the write" (Customer/28377, "Region code is required", safe to retry after correction).
Bulk ops only where provably safe (retry external rejections after a fix); identity and conflict always one at a time (KDX-D4). Empty state: "No exceptions — there are no records waiting for review." No celebration UI.

### 08 Exception detail — identity / possible duplicate
Kicker "IDENTITY · NEEDS REVIEW"; H1 "Possible duplicate customer"; provenance line (Accounting Sync · RUN-001827 · detected 3:16 PM).
Left: INCOMING RECORD · ACCOUNTING — ACME Food Services, Phoenix AZ, External ID 28391, billing email, owner.
Right: POSSIBLE MATCHES IN SERVICE PLATFORM — ACME Food Service (Phoenix, since 2021, 214 orders) 87% confidence; ACME Foods (Tempe, since 2019, 48 orders) 61% confidence. Confidence is evidence, never an auto-decision; no threshold silently merges.
Actions: Link to existing (primary) · Create new (secondary) · Ignore (ghost). Contract copy: the decision is recorded to the audit trail and applies a cross-reference. Until automatic reprocessing is certified, the state reads "Decision recorded · Reprocessing pending" — the UI never claims reprocessing completed merely because that is the desired rule.

### 09 Conflict resolution — manual-review path
Kicker "CONFLICT · MANUAL REVIEW REQUIRED"; H1 "Customer name changed in both systems"; line naming the field's configured authority: Manual review. (Other path: when a field has a system authority, NO exception is raised — the authority value is retained and the run notes it.)
Side-by-side values first, provenance second: ACCOUNTING (INCOMING) "ACME FOOD SERVICE" (changed 2:58 PM by jortiz) vs SERVICE PLATFORM (CURRENT) "Acme Food Services" (changed 3:04 PM by S. Whitcomb).
CHOOSE THE VALUE TO KEEP — exactly two radios: retain the source (Accounting) value / retain the destination (Service Platform) value. There is NO "Enter another value" option. If neither value is correct, the operator corrects the appropriate authoritative system and KDX ingests the corrected value.
Copy: "The chosen value is recorded as the resolution for this conflict and is written according to the integration’s configured authority and certified capabilities. The decision is recorded to the audit trail." Where outbound write-back is not certified, propagation is never implied; write-to-both-systems language is prohibited.
Actions: Resolve conflict (primary) · Decide later (ghost).

### 10 Connections
The one card collection (discrete items with per-item actions — KDX-D8). Header contract line: "Credential state is shown, never credential contents." Primary: New connection.
Four cards (kicker = connector type, title, state fact lines, action links):
- Production CRM · REST API · Connected · last checked 2 min ago · used by 3 integrations · Test/Edit/Disable.
- Accounting · Application Adapter · "Credentials expire in 3 days" (magenta) · used by 1 · runs continue until expiry · Renew credentials/Test/Edit.
- Service Platform · Application Adapter · Connected · used by 5 · Test/Edit/Disable.
- Vendor API · Webhook ingress · Degraded (magenta) · "2 of 14 ingress deliveries failed in the last hour" · Automatic retry scheduled · View ingress evidence/Edit — no Test connection: webhook ingress does not declare an outbound connection test.
"Last checked" is the health-probe timestamp, not the last run. Disable warns with the count of integrations that would stop.

## 7. Named design decisions
KDX-D1 grouped IA · KDX-D2 word-first status vocabulary · KDX-D3 typographic connection path, never a node editor · KDX-D4 identity/conflict resolved singly, bulk only for provably safe retries · KDX-D5 environment as a word in a fixed rail slot (+production banner), never color-only · KDX-D6 collections show last SUCCESSFUL run · KDX-D7 no ETAs, records-based progress only · KDX-D8 cards only for Connections, tables elsewhere. KDX-D9 capability vocabulary (Certified · Awaiting Certification · Unavailable) is separate from operational health — a capability that cannot run has no health. KDX-D10 automation chains render honest pending states ("Resolution recorded · Reconciliation pending", "Decision recorded · Reprocessing pending") until executable proof exists.

## 8. Gaps (truthful, not designed around)
KDX-G1 sandbox certification NOT AUTHORIZED — badge reflects sandbox honestly. KDX-G2 outbound/bidirectional PARTIAL — unreal capabilities render disabled with a one-line reason, slot preserved. KDX-G3 recovery PARTIAL — "resumable" prints only with intact checkpoint. KDX-G4 connectors PARTIAL — picker lists only real connectors (CSV/XLSX, JSON, REST, Webhook, Application Adapter). KDX-G5 admin UX PARTIAL — Administration page deferred to P3 against real controls only.

## 9a. Open product-policy questions
Open product-policy questions: ZERO.
Closed: KDX-Q1 (no third arbitrary value in manual conflict resolution; a governed override may come later only if the consuming adapter declares override, validation, and write-back support) · KDX-Q2 (automatic resolution→reprocess→reconcile→update chain is the product rule; pending states render until proven) · KDX-Q3 (90-day resolved-history inbox window; audit retention is separate and governed by platform policy).

## 10. Reusable component templates
Every P1 frame is composed from these templates; reuse them verbatim across the product.
- **Shell / rail** — 236px left rail: brand block, grouped nav (small-caps group kickers, cyan+bold active item), bottom context stack (TENANT / ENVIRONMENT / user). Fixed on every page.
- **Page header** — 42px serif H1 + one-line computed status subhead; optional right-aligned primary button.
- **Environment badge** — the environment-model word in the rail slot, bold, .06em letter-spacing: LOCAL · SANDBOX · NOT CERTIFIED (current) · SANDBOX (certified only) · PRODUCTION (plus content-top banner). Never color-only.
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
        <div style="font-size:14px;font-weight:700;margin-top:3px;letter-spacing:.06em;">SANDBOX · NOT CERTIFIED</div>
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
    <div style="font-size:15px;color:#4a4846;margin-top:6px;">7 integrations · 2 need attention · 2 awaiting certification</div>
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
  <div><div style="font-size:36px;font-weight:600;">5</div><div style="font-size:11px;letter-spacing:.14em;color:#6b6866;margin-top:2px;">ACTIVE INTEGRATIONS</div></div>
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
      <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;">Accounting Sync<div style="font-size:12.5px;color:#6b6866;">Accounting → Service Platform</div></td>
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
    <div style="font-size:13.5px;color:#4a4846;margin-top:2px;">3 records need review — 1 identity match, 1 authority conflict, 1 external rejection. Last successful sync 18 min ago.</div>
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
    <div style="font-size:14px;color:#4a4846;margin-top:4px;">Accounting · Customer #28391 · 2 possible matches · Detected 4 minutes ago</div>
  </div>
  <button style="font:600 14px 'Source Serif 4',serif;background:transparent;color:#006a8a;border:1px solid #0088b0;border-radius:2px;padding:7px 16px;cursor:pointer;">Review</button>
</div>
```

### Conflict comparison + choice
```html
<div style="display:grid;grid-template-columns:1fr 1fr;gap:80px;max-width:960px;">
  <section>
    <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">ACCOUNTING (INCOMING)</div>
    <div style="font-size:26px;font-weight:600;margin-top:10px;">ACME FOOD SERVICE</div>
    <div style="font-size:13px;color:#6b6866;margin-top:10px;">Changed today 2:58 PM · by jortiz</div>
  </section>
  <section>
    <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">SERVICE PLATFORM (CURRENT)</div>
    <div style="font-size:26px;font-weight:600;margin-top:10px;">Acme Food Services</div>
    <div style="font-size:13px;color:#6b6866;margin-top:10px;">Changed today 3:04 PM · by S. Whitcomb</div>
  </section>
</div>
<div style="display:flex;flex-direction:column;gap:14px;font-size:16px;margin-top:24px;">
  <label style="display:flex;gap:10px;align-items:center;"><input type="radio" name="cval" style="accent-color:#0088b0;">ACME FOOD SERVICE <span style="font-size:12.5px;color:#6b6866;">— Accounting</span></label>
  <label style="display:flex;gap:10px;align-items:center;"><input type="radio" name="cval" checked style="accent-color:#0088b0;">Acme Food Services <span style="font-size:12.5px;color:#6b6866;">— Service Platform</span></label>
</div>
<div style="font-size:14px;color:#4a4846;margin-top:16px;">The chosen value is recorded as the resolution for this conflict and is written according to the integration’s configured authority and certified capabilities. The decision is recorded to the audit trail. If neither value is correct, correct it in the authoritative system — KDX will ingest the corrected value.</div>
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
  <div style="font-size:15px;color:#4a4846;margin-top:8px;line-height:1.7;">2,183 of 7,411 records were processed before the connection failed.<br><span style="font-weight:600;color:#201e1d;">Progress has been saved.</span> Automatic retry scheduled.</div>
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
  <div style="font-size:13.5px;color:#4a4846;margin-top:3px;">3 records need review · last success 18 min ago</div>
</div>
```
Mobile top bar keeps tenant + environment words visible; all touch targets >=44px.

### Connection card — webhook ingress variant (capability-driven actions)
```html
<div style="background:#fff;border-radius:2px;box-shadow:0 1px 3px rgba(32,30,29,.12);padding:24px;width:480px;">
  <div style="font-size:10.5px;letter-spacing:.16em;color:#8a8785;font-weight:600;">WEBHOOK INGRESS</div>
  <div style="font-size:20px;font-weight:600;margin-top:6px;">Vendor API</div>
  <div style="font-size:14.5px;color:#4a4846;margin-top:10px;line-height:1.7;"><span style="font-weight:700;color:#a30052;">Degraded</span> · 2 of 14 ingress deliveries failed in the last hour<br>Used by 1 integration · Automatic retry scheduled</div>
  <div style="display:flex;gap:16px;margin-top:16px;">
    <a href="#" style="font-size:14px;font-weight:600;color:#006a8a;text-decoration:none;">View ingress evidence</a>
    <a href="#" style="font-size:14px;font-weight:600;color:#006a8a;text-decoration:none;">Edit</a>
  </div>
</div>
```
Actions derive from the connector's declared capability contract — webhook ingress declares no outbound connection test, so no Test action renders; REST declares Test Connection; Application Adapter actions follow its declared set. Do not place unsupported actions into shared static card definitions. Retry timing prints a real time only when the runtime supplies nextRetryAt (or equivalent); otherwise "Automatic retry scheduled".

### Integrations table row — awaiting-certification capability slot
```html
<tr>
  <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;"><a href="#" style="color:#006a8a;font-weight:600;text-decoration:none;">CRM ↔ Service Platform</a><div style="font-size:12.5px;color:#6b6866;">Activation unavailable until outbound synchronization is certified</div></td>
  <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;">Bidirectional</td>
  <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;font-weight:600;color:#6b6866;">Awaiting Certification</td>
  <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;">—</td>
  <td style="padding:12px 16px 12px 0;border-bottom:1px solid #dedcdb;">—</td>
  <td style="padding:12px 0;border-bottom:1px solid #dedcdb;text-align:right;">0</td>
</tr>
```
No health word, no timestamps, no next run, no traffic or write-back claims on unavailable capability slots.

## 14. P1v4 report
**Design coverage** — 10 P1 frames COMPLETE (Overview, Integrations, Integration Detail, Connections, Runs, Run Detail, Exceptions, Exception Detail, Conflict Resolution, Reconciliation). P2 configuration/migration and P3 platform-ops/responsive frames not started.
**Correctness reconciliation** — Single-authority document; conflict wording per approved §5 (no system-of-record implication); pending automation states preserved (KDX-D10); no write-to-both-systems, third-value, plain-SANDBOX, or unsupported-retry language remains.
**Fixture reconciliation** — One census everywhere: 7 integrations · 5 active/configured · 2 running · 2 need attention (integration-level) · 2 awaiting certification; Overview metrics 5 / 2 / 14 / 3 (the 3 spans integration + connection state: Accounting Sync, Accounting credentials, Legacy Orders Import — distinction preserved). One exception dataset everywhere: Customer/28391 Identity · Customer/23819 Conflict · Customer/28377 External Rejection, all on RUN-001827 (Accounting Sync); inbox filters 3/1/1/1, resolved 12. Run arithmetic reconciles: 2,411 = 2,408 + 3; results 102+2,201+105+0+1+1+1 = 2,411; Matched stage removed (not a stable engine counter). Field authority endpoint-local (Customer name→Service Platform · External account ID→CRM · Billing email→CRM · Customer owner→Service Platform). Date fixture: Wednesday, September 2, 2026 (or runtime-derived).
**Component reconciliation** — Every §13 template updated to the same fixture: census subhead, 5-integration metric, Accounting Sync run row, 3-exception attention row, Accounting exception row, ACCOUNTING (INCOMING)/SERVICE PLATFORM (CURRENT) conflict comparison with the approved resolution copy, environment-model shell badge, scheduled-retry failure state, capability-driven connection cards, awaiting-certification table row, mobile restack. No component HTML disagrees with prose.
**Capability reconciliation** — Unchanged from P1v3: inbound/import operational; outbound/bidirectional are Awaiting Certification slots with no health, timestamps, traffic, or write-back; pending states until executable proof; environment renders SANDBOX · NOT CERTIFIED (LOCAL for local runtime).
**Open product-policy questions** — ZERO.
**Implementation-readiness verdict** — IMPLEMENTATION READY FOR CODEX. Engineering bind list: pipeline counters to executable KDX facts; automatic resolution→reprocess→reconcile→update chain; nextRetryAt read; connector capability declarations read; outbound/bidirectional activation upon certification.
