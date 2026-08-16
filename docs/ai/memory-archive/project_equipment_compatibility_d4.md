<!-- ARCHIVED AI WORKING NOTES — NOT AUTHORITY -->
> **Historical AI working notes**, moved out of Claude's private memory on 2026-08-16 so they are
> visible and auditable in the repository. **This file is not authoritative.** The authoritative
> record for this workstream is the linked `docs/` specification, DECISIONS entry, or PR history.
> Retained verbatim so nothing is lost; do not cite it as a decision of record.

---
name: project_equipment_compatibility_d4
description: "Equipment/Part Compatibility D4 trusted persistence (PR #459 draft) — Stage B.1 contracts and the governed alias identity decision"
metadata: 
  node_type: memory
  type: project
  originSessionId: bb883716-63dd-43b5-bce2-440afb008560
  modified: 2026-07-29T20:31:49.882Z
---

Part–Equipment Compatibility workstream: D1 (equipment model) and D2 (compatibility)
pure contracts are merged and live in `field-ops-app-vite/src/domain/`. **D4 (trusted
persistence) MERGED 2026-07-28** — PR #459 final Codex PASS at 187b0ea, repository-only merge
(merge-commit 24573ae, now origin/main); branch + worktree deleted. Stage plan (all PASSed):
A domain foundation, B.1 operation state machine, B.2 repository adapters, C command
orchestrator, D registry+Rules, E emulator tests. **D4 is repository-only: equipment.*
capabilities stay active:false + ungranted, 5 collections client-closed in Rules (NOT deployed),
no callable exported. D5 (read service) + D10 (Rules deploy) are SEPARATE authorization gates —
not begun.** Merge was gated on: PR head == reviewed head, origin/main not advanced past the
synced base, DRAFT/MERGEABLE/CLEAN + all checks green — reconfirm those before any future merge.

**D5 (read service) — AUTHORIZATION PACKAGE Codex PASS 2026-07-28, AWAITING OWNER decision.**
Docs-only DRAFT PR #465 (`docs/equipment-compatibility-d5-authorization`, head 3f79522), one file:
`docs/implementation-plans/equipment-compatibility-d5-read-service.md`, status "PENDING — NOT
AUTHORIZED". Verbatim D5 gate = architecture §10.6 "Read service: bounded bidirectional queries and
fail-closed read model; no UI source fallback." Package proposes a server-only emulator-only read service
(forward by partId / reverse by equipmentModelId via `where(field,==,X).orderBy(documentId())`;
bounded evidence window; page/window-scoped pageDisposition+windowCounts; untrusted navigation cursor
posture B — NOT an authz boundary; index outcome proof-driven, any index repo-only until D10). Codex
review took 3 rounds (R1: pagination/index+evidence-fanout+response-fail-closed; R2: cursor-integrity
posture B + window-scoping/no-snapshot-isolation). **HARD STOP: Codex PASS ≠ Owner authorization; do NOT
implement D5, merge #465, or request OD-1..OD-6 on the Owner's behalf — keep DRAFT until Owner explicitly
decides.** OD-1 (build behind inactive capability) is the primary decision; OD-3 revised to proof-driven
index. D6/#226 activation/D10 deploy/installed-asset linkage/Truck Inventory all remain unauthorized.

**D5 read-service — Owner APPROVED OD-1..OD-6 2026-07-28; docs PR #465 MERGED (merge 49af756, now on
main); IMPLEMENTATION PR #466 DRAFT awaiting Codex review** (branch feature/equipment-compatibility-d5-
read-service, head 775e9c9, 16/16 checks CLEAN). Files (all NEW, repository/emulator-only): functions/src/
equipmentCompatibility/readService.ts (forward where partId== / reverse where equipmentModelId==, both
orderBy(FieldPath.documentId()) so NO composite index; page/window-scoped disposition AVAILABLE/DEGRADED/
EMPTY/UNAVAILABLE/DENIED; bounded evidence window=20 + per-request budget=100 → INCOMPLETE forces
operational:false; sanitized; injected resolvePermission seam), readCursor.ts (untrusted navigation
cursor posture B — unsigned, NOT an authz boundary), equipmentCompatibilityReadCallable.ts (onCall,
actor from request.auth.uid, **NOT exported from index.ts** = inert; resolves active:false view → denies).
Tests: equipmentCompatibilityReadCursor (7 pure) + equipmentCompatibilityReadEmulator (13) +
equipmentCompatibilityReadCallable (10). Codex review R1 P1+P2 CORRECTED at head 3a388fa (16/16 CLEAN):
P1 hard evidence budget (cap query limit by remaining budget so actual reads never exceed 100; distinguish
overflow vs budget-truncation; validate request shape BEFORE grant so InvalidInputError→invalid-argument
is reachable/leak-free); P2 exact per-mode callable shapes + extracted testable handleReadRequest core.
Verified: unit 191, emulator 34 (D4 11 + D5 read 13 + D5 callable 10), effectiveAccess 23.
**D5 read-service MERGED 2026-07-29** — Owner-authorized repository-only merge of impl PR #466 at
Codex-PASSed head 3a388fa; merge commit **7664c5e** (now origin/main); branch + worktree deleted, main
synchronized. Pre-merge gates reconfirmed (head==authorized SHA, origin/main 49af756 clean ancestor/no
drift, MERGEABLE/CLEAN, 16/16 checks, scope == the 9 reviewed D5 files). **D5 is repository-only, NOT
deployed:** equipment.compatibility.view stays active:false + ungranted, the read callable is present but
UNEXPORTED from index.ts (inert), no Rules/index/Functions deployed, no client path opened. Still
UNAUTHORIZED (each its own gate): #226 activation/grants, callable export, D10 deploy, production access,
D6 UI, D7 installed-asset linkage, D11, Truck Inventory, downstream consumers, Customer/Auth. NO shared production source touched; equipment.compatibility.view stays
active:false. **HARD STOP: no activation/grant/callable-export/deploy/D6/D7/D10/D11/Truck/downstream/
Customer-Auth. Return completed D5 impl for Codex review before merge; do NOT merge without Owner
authorization** (Owner pre-authorized merging the DOCS PR #465, not the impl PR #466 — that needs its own).

**D6 (Part Detail "Used In Equipment" UI) — AUTHORIZATION PACKAGE Codex FINAL PASS 2026-07-29 at head
93eefc9, AWAITING OWNER OD-A..OD-F + implementation authorization.** Docs-only DRAFT PR #474
(`docs/equipment-compatibility-d6-authorization`), one file
`docs/implementation-plans/equipment-compatibility-d6-parts-catalog-ui.md`, PENDING—NOT AUTHORIZED, base
main 3591fa8. Verbatim gate = architecture §10.7. Design: capability-gated INERT fail-closed section in
Inventory PartDetail.jsx (route /inventory/:partId) consuming the D5 read CONTRACT via an injectable
EquipmentCompatibilitySource; since equipment.compatibility.view is active:false the section is HIDDEN +
reads nothing in the running app (inert like the D5 callable). KEY (Codex R1 P1 fix): explicit capability
prop seam App→AppRoutes(operationalContext.hasCapability)→PartDetail hasCapability prop→UsedInEquipmentSection
(mirrors SavedReports App.jsx:201; PartDetail currently PROPLESS at App.jsx:329); renders only on exact
hasCapability("equipment.compatibility.view")===true, else HIDDEN with ZERO source reads; client gate is
read-suppression defense only, server enforces. Repo test convention: pure view-model node:assert tests +
Playwright browser gate (no JSDOM). Six Owner decisions OD-A..OD-F (placement/inactive-hide/allowlist/
pagination page-size-10/mobile/callable-seam). **D6 docs PR #474 MERGED (44847b6) + OD-A..OD-F APPROVED by Owner 2026-07-29.**

**D6 IMPLEMENTATION — DRAFT PR #475 at head 7fd656c, AWAITING independent Codex review + separate Owner
merge decision.** Branch feature/equipment-compatibility-d6-parts-catalog-ui, base main 44847b6, 3/3
checks CLEAN. Repository-only + INERT (equipment.compatibility.view active:false → section HIDDEN, reads
nothing in the running app). Files: NEW src/domain/equipmentCompatibilitySection.js (pure view-model,
imports nothing, no-fallback; canViewCompatibility/loadCompatibilityPage read-gate zero-reads;
fail-closed disposition mapping; sanitized allowlist no ids/provenance; sticky pagination) +
src/services/equipmentCompatibilitySource.js (inert placeholder → {ok:false,unavailable}; real onCall
binding is D10) + src/modules/inventory/UsedInEquipmentSection.jsx (returns null when not granted;
Show-more page size 10; a11y; responsive table→cards) + test/equipmentCompatibilitySection.test.mjs (15
offline checks incl. zero-read + prop-path source-scans) + .github/workflows/equipment-compatibility-
ui-tests.yml (frontend unit+lint+typecheck+build, path-gated). MODIFIED App.jsx (PartDetail hasCapability
prop, was propless), PartDetail.jsx (accept+forward prop, render section after Catalog card), index.css
(D6 CSS), package.json (test chain). NO backend/Rules/catalog/index change. Verified: frontend chain +15
D6, oxlint 0 D6 warnings, tsc clean, vite build + verify:build-base pass. Rendering/a11y via
run-field-ops-app-vite browser gate (repo convention, no committed Playwright spec). **HARD STOP: do NOT
merge #475 without a separate Owner merge decision; still unauthorized: activation/grant, callable export,
D10 deploy, D7/D11, Truck, downstream, Customer/Auth, Part-ID change.**

**D6 impl Codex R2 CHANGES-REQUESTED addressed + PUSHED — PR #475 now at head eae43394d439ad161276d29eff506df72a7a7924, DRAFT/MERGEABLE, 3/3 green, awaiting FINAL Codex review + separate Owner merge decision.** Five R2 corrections: (1) fail-closed malformed/hostile D5 payloads (projectItem returns null for null/array/primitive/empty/bad-enum → omitted+counted → DEGRADED; model present only if identity fields validate; never operational); (2) cross-Part stale prevention via queryKey=`partId::accessVersion` (stored={key,data}; render shows only key-matching data → prior rows/cursor unrenderable immediately); (3) accessVersion threaded App→PartDetail→UsedInEquipmentSection (refetch/reset on change); (4) copy neutralized ("Showing N equipment compatibility records"; "No more records to load" only when clean+complete; no whole-query claim); (5) CI-enforced component render/lifecycle test test/usedInEquipmentSection.test.jsx via NEW Vitest+jsdom harness (vitest.config.js jsx:automatic, does NOT load Vite-8 react plugin into vitest runtime; test:components script; devDeps vitest/jsdom/@testing-library/react+dom; wired into equipment-compatibility-ui-tests.yml). 12-file scope incl. package-lock.json. Verified GREEN: components 9/9, pure 19/19, full chain, lint(0 D6 warnings)/typecheck/build/verify:build-base 12/12. **NOTE: Codex did the in-worktree verify + the commit/push (fix: harden D6 compatibility UI lifecycle) while my Bash classifier was intermittently unavailable — head eae4339 reported by coordinator, independently reconfirm via gh when Bash is back before any merge.**

**D6 impl Codex FINAL review R3: ONE P1 (evidence completeness) — CORRECTION WRITTEN, pending run/push.**
Bug at eae4339: operational keyed off evStatus==="OK" but windowComplete could be false, so an inconsistent
payload (evidence OK + windowComplete:false + operational:true + VERIFIED) rendered operational and the
page could stay AVAILABLE (clean completion msg) when server windowCounts.evidenceIncomplete wrongly=0.
Fix in equipmentCompatibilitySection.js: reclassify evStatus OK-without-windowComplete → INCOMPLETE;
operational now requires evStatus==="OK" && windowComplete; build counts clientEvidenceIncomplete
(items with evidence.status!=="OK") → forces DEGRADED + counts.evidenceIncomplete=max(server,client) so a
server 0 can't keep it clean; cleanComplete already gated on state AVAILABLE + evidenceIncomplete===0.
Regression added to equipmentCompatibilitySection.test.mjs (OK+windowComplete:false+operational:true →
INCOMPLETE/non-operational/evidence-incomplete reason/DEGRADED/evidenceIncomplete>=1, server count 0 not
trusted). Statically verified; existing tests unaffected.

**D6 impl Codex FINAL PASS 2026-07-29 at head 6ce6bd9d4ea22d0a7df4a57a3aab4851f7928027** (P1 fix
run+pushed; head advanced eae4339→6ce6bd9). DRAFT/OPEN/MERGEABLE/CLEAN, 3/3 GitHub checks PASS; pure 20/20,
components 9/9, full chain, lint(0 D6 warnings)/typecheck/build/verify-base 12/12 all green; reviewed
12-file scope. **D6 impl MERGED 2026-07-29** — Owner-authorized repository-only merge of PR #475 at Codex-PASSed head
6ce6bd9; merge commit **13e44fe** (now origin/main); branch + worktree deleted, main synced. Pre-merge
gates reconfirmed: head==6ce6bd9; origin/main had advanced (44847b6→0758d2d) but touched ZERO of the PR's
12 files (disjoint — no overlap, clean merge); MERGEABLE/CLEAN; 3/3 checks; 12-file reviewed scope. **D6 is
repository-only + INERT: equipment.compatibility.view stays active:false + ungranted, the section is HIDDEN
and reads nothing in the running app, the inert source performs no backend call, the D5 callable stays
UNEXPORTED, no Rules/index/Functions/Hosting deployed, no client path opened.** Equipment Compatibility
domain now D0–D6 merged (arch, D1/D2 contracts, D3 dry-run, D4 persistence, D5 read service, D6 Part
Detail UI) — all repository-only. Still each its own separate gate (UNAUTHORIZED): #226 activation/grants,
callable export, D10 deploy, D7 installed-asset linkage, D11 import, Truck Inventory, downstream consumers,
Customer/Auth, Part-ID changes.
B.1 PASS 0db4f90, B.2 PASS dff5af9, C.1 PASS 5d28455, C.2 PASS 20062c6, Stage D PASS f4e9fcb
(two CI-enforcement fixes on the 8d23fec CHANGES-REQUESTED: both firestore.rules mirrors byte-compared
in the registry test + client mirror added to the parity workflow paths; the audit-writer test now
exercises the real exported stageAuditEvent instead of silently skipping a non-exported builder).
Stage E landed at f6c1020 (final D4 head) awaiting review -- 15/15 checks CLEAN, still DRAFT. Each
stage needs its own Codex PASS -- a prior PASS applies only to the exact head it names, and reviews
routinely take 3-4 rounds, so budget for that.

**Stage E (f6c1020):** `functions/test/equipmentCompatibilityEmulator.test.mjs` (11 checks) + workflow
`equipment-compatibility-emulator-tests.yml` + `test:equipmentCompatibilityEmulator` script. Proves,
against a LIVE Firestore+Auth emulator: (A) all 5 governed collections DENY direct client
read/list/create/delete for admin/dispatcher/technician/unauth (Rules ENFORCED, not just declared as in
Stage D); (B) full TX1/TX2 lifecycle on the real backend; (C) the genuine two-concurrent-command race
converging to one applied record/one initiation. Zero production source touched -- tests+workflow+
package.json only; equipment.* stay active:false; deploy is still the separate D10 gate.
Emulator run note: firebase-tools is NOT in the worktree functions/node_modules (dev deps absent) --
use the GLOBAL `firebase` CLI, start from the worktree ROOT so it loads that branch's firestore.rules,
and kill the process TREE afterward (the Java child leaks otherwise). See [[reference_firebase_tools_emulator_runner_gotchas]].

D4 mirrors D1/D2 into `functions/src/equipmentCompatibility/domain/` as a SERVER PORT.
The two copies must never be edited singly — `functions/test/equipmentCompatibilityDomainParity.test.mjs`
enforces behavioral parity in CI (`npm run test:equipmentCompatibilityUnit`, workflow
`equipment-compatibility-domain-parity-tests.yml`). Any new predicate belongs in BOTH
mirrors plus the parity corpus, never restated privately in `operations.ts`.

**Owner decision, 2026-07-27 — model alias identity contract:**
- The alias key is a PURE IDENTITY string that may contain `/`. Storage safety comes from
  percent-encoding at the persistence boundary (`encodeModelAliasDocId`: `%` first, then
  `/`), following the governed Part Master precedent in
  `functions/src/partMaster/partAliasRepository.ts` `encodeAliasDocId` (ADR-008 / Decision #40).
- `MODEL_ALIAS_VALUE_MAX = 120`, matching Part Master's `MAX_IDENTIFIER_LENGTH`, applied to
  the NORMALIZED value. `MODEL_ALIAS_DOC_ID_MAX_BYTES = 1500` (Firestore's hard limit)
  applied in UTF-8 BYTES to the ENCODED doc id — not UTF-16 code units, which undercount
  multibyte values.

**Why:** an earlier arbitrary 512-code-unit bound let a 500-emoji alias derive a 2020-byte
key, and `validateEquipmentModelAlias` could mint identities its own canonical predicate
rejected. Both bounds are now traceable to an existing authority rather than invented.

**How to apply:** when touching alias identity, keep the invariant that every successful
validator output is canonical and persistence-safe, and reach for the Part Master
precedent before inventing a new rule. See [[feedback_chatgpt_review_before_merge]] —
Codex reviews these stages and routes identity-contract choices to the Owner.

**Two mirrored-file traps this workstream keeps hitting** (both caught by CI, not locally):
- `firestore.rules` has a SECOND copy at `field-ops-app-vite/firestore.rules`; the canonical rules
  regression asserts they are BYTE-identical, including line endings. Edit both, and don't let a
  Python rewrite flip CRLF to LF.
- `permissionCatalog` is mirrored at `functions/src/access/` and `field-ops-app-vite/src/access/`.
  Those two are ALREADY out of parity at 8d23fec: the server carries `inventory.catalog.manage` /
  `.activate` (INV-1 Phase 1 PR 1.2) that the client lacks. Reported, not repaired -- INV-1's call.

**Why:** three separate CI failures in this workstream came from editing one mirror only.

**How to apply:** after touching any mirrored governed file, diff the committed blobs AND the on-disk
bytes before pushing.
