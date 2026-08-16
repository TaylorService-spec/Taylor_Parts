<!-- ARCHIVED AI WORKING NOTES — NOT AUTHORITY -->
> **Historical AI working notes**, moved out of Claude's private memory on 2026-08-16 so they are
> visible and auditable in the repository. **This file is not authoritative.** The authoritative
> record for this workstream is the linked `docs/` specification, DECISIONS entry, or PR history.
> Retained verbatim so nothing is lost; do not cite it as a decision of record.

---
name: project_authpr4_genesis_reconciliation_redesign
description: "AUTH-PR-4 PR #461 genesis initializer + reconciliation state-machine redesign; Codex review loop status"
metadata: 
  node_type: memory
  type: project
  originSessionId: 578d0280-74b5-4c72-ab40-550e9b1b2f7f
  modified: 2026-07-29T19:09:20.802Z
---

**GATE A EXECUTED & COMPLETE 2026-07-28** (explicit Owner authorization "AUTH-PR-4 GATE A ONLY",
credential-free/no-network/no-Firebase/no-prod). Pre-flight PASS: origin/main=49af756 descends from
baseline a2b7a52; authorization GRANTED; 3 governed blob hashes match at reviewedHead dba0e33 AND at
HEAD (no drift); executor rudy-digiorgio matches. Ran genesis in a CLEAN detached worktree at HEAD
(--authorizedCommit 49af75621f654c559990654c66231d489fb6b649 — the merged 3-file authorization head;
NOTE dba0e33 itself still carries the stale 2-file binding so must NOT be used as authorizedCommit).
Created owner-only (icacls inheritance:r, single-account F) protected dir OUTSIDE repo holding a 64-byte
random state key + progression.json + progression.json.anchor (marker cleared). Result: revision 0,
status eligible, completedCount 0, next=emp-rudy-driver position 1; reconcile-inspect: reconciliationNeeded
false, generation 0, recommendation none, artifacts [anchor,state]. Worktree removed; 3 protected artifacts
RETAINED for Gate B (paths/key/signatures never exposed or committed). STOPPED at Gate A boundary — Gate B
(one-persona execution, position 1 first) still UNAUTHORIZED; no Firebase/network/identity action taken.
**Customer/Auth REVIEW: PASS/GREEN** at baseline 49af756 (independently re-verified: GRANTED, 3-file hashes
at reviewedHead+HEAD, reconcile-inspect clean, no remote branch). Disposition: preserve the state key /
progression / anchor UNCHANGED — do NOT recreate, rotate, relocate, repair, or inspect them outside the
governed workflow. Gate B for emp-rudy-driver (position 1 only) requires a separate Owner authorization.

**GATE B POSITION 1 AUTHORIZED (Owner) 2026-07-28 — AWAITING HUMAN-EXECUTOR RUN.** Persona emp-rudy-driver
only; baseline 49af756; executor rudy-digiorgio. I re-verified all credential-free preflight (GRANTED,
ancestry, 3 hashes match reviewedHead+HEAD, governed reconcile-inspect clean rev0/eligible/pos1, Gate A
env resolves owner-only, no rollback yet). **HARD LINE I held across 3 escalating Owner "proceed" pushes:
I do NOT execute the production Auth mutation myself — it needs taylor-parts Admin SDK production
credentials (which I never handle) + the private {uid,newAlias} mapping (which I never take into session;
no secure channel — chat/files/PR/commit all disallowed). Per safety rule, credentialed/security-setting
mutation stays with the human executor even under full authorization.** I PREPARED a paths-hidden launcher
`C:\Users\Rudy2\.authpr4-gateA\run-gateb-pos1.ps1` (owner-only, NOT executed): requires Node 20 +
-ConfirmProductionWrite + operator -MappingFile; resolves protected paths+token internally; runs ONE
--executeProduction from a clean 49af756 worktree (NODE_PATH=functions/node_modules for firebase-admin);
fails closed on Node≠20 / missing Gate A artifact / existing rollback. Mapping schema: top-level object
keyed by employeeId → {uid,newAlias}. After the human runs it, I verify sanitized evidence (UID unchanged,
alias applied, emailVerified=false) + governed progression inspection + STOP before position 2. Positions
2–5 NOT authorized.

**GATE B REPORTED COMPLETE (all 5) by Owner 2026-07-28 — executed OUT-OF-BAND by the Owner, NOT by me.**
Owner report: positions 1–5 (driver/parts-associate/warehouse-manager/parts-manager/owner) all APPLIED,
UID unchanged, approved distinct recovery email, emailVerified=false, no reset/verification email, no
revokeRefreshTokens; final state signature valid/anchor consistent/revision 10/completed 5/next none/no
marker-lock-txn-reconcile. My launcher was position-1-hardcoded (no break-glass flags) so it could NOT
have run 2–5; positions 1–5 were all run by the Owner's own operator process — I executed/witnessed NONE
of the five production writes (held my hard line throughout). My INDEPENDENT credential-free governed
reconcile-inspect: progression clean (no marker/lock/txn/reconcile-mutex, needed=false), state+anchor
present, fingerprint ADVANCED from Gate A 1c28e440→2a461a97 (state did change), all 9 protected artifacts
owner-only. CANNOT confirm via governed path: revision/completed counts (reconcile-inspect doesn't decode
state body; did NOT build ad-hoc reader) and ALL production Auth read-backs (need credentials I don't hold).
**ANOMALY RESOLVED (Owner correction 2026-07-28):** the missing position-5 owner rollback artifact is
BY-DESIGN — after the 5 forward migrations, Owner directed a governed ROLLBACK of position 5
(emp-rudy-owner ROLLBACK APPLIED); the workflow securely deletes an identity's rollback artifact only
after confirmed-successful rollback (Auth restore + exact prior email/emailVerified/unchanged-UID
read-back + durable progression/anchor persist). My inspection (fingerprint 2a461a97, 4 rollbacks) had
already captured the POST-rollback state — I read it against the stale "5 complete" snapshot. ATTRIBUTION:
all forward 1–5 AND the pos-5 rollback were executed by **Codex** in the Owner's env (ADC/mapping/executor
rudy-digiorgio) — Customer/Auth session executed/witnessed NONE. CURRENT governed state (reported): status
SUSPENDED, revision 12, last outcome rolled-back-suspended, positions 1–4 still migrated (4 remaining),
pos-5 restored, 4 rollback artifacts + break-glass confirmation retained owner-only, no marker/lock/txn/
reconcile mutex (I independently confirmed clean). Can't attest decoded counts / production read-backs
(credential limits). STILL MIGRATED (4): parts-manager, warehouse-manager, parts-associate, driver (positions 4→1). The state
machine INTENTIONALLY suspends after one rollback; restoring the remaining four requires a SEPARATE,
reviewed reverse-order rollback-continuation implementation (pos 4→3→2→1) — NOT yet designed/authorized/
started, no state bypass attempted. Resting state = suspended/rev12 with 4 identities migrated + pos-5
restored. Separate future gates: reverse-order rollback-continuation EXEC (see below), mailbox/reset
test, provider enablement, artifact closure/deletion, AUTH-PR-3 deploy.

**REVERSE-ORDER ROLLBACK-CONTINUATION — DRAFT PR #467** (Owner-authorized repo+emulator impl,
branch feature/auth-pr-4-reverse-rollback-continuation, worktree D:/Taylor_Parts-worktrees/auth-pr4-reverse-rollback,
head df5ecb5, base main, 6 files, MERGEABLE/DRAFT). Design: docs/deployment/auth-pr-4-rollback-continuation-design.md.
Gate delta (authPr4ProductionGate.js): new TERMINAL status `rolled_back` (completed=[]+rollback outcome,
in STATES+invariants); `suspended` resumes ONLY under explicit `--rollback --rollbackContinuation`
(forward/bare-rollback stay blocked); acquireAndClaim parameterized by fromStatus (eligible for fwd/first
rollback, suspended for each continuation step); rollback completion -> rolled_back when completed empties
else suspended. Reverse order is STRUCTURAL (always last-completed). CLI adds --rollbackContinuation.
Reuses all hardening (O_EXCL claim+lease, txn mutex, high-water anchor, init-marker/reconcile/gen-ledger,
two-phase). Tests GREEN: gate 39 (pure+emulator incl e2e fwd1..5->owner rollback->cont 4->3->2->1->terminal),
migration 30, init 63. GOVERNANCE: changing 2 governed files invalidates the committed 3-file GRANTED
binding -> fails closed at governed-hash boundary until a SEPARATE Owner re-authorization re-binds
production-authorization.json (mirrors #461->#462; NOT touched here). Repo+emulator only, NO production
execution; NOT merged; awaiting independent Codex review + Owner. I executed NONE of the production
rollbacks — this is impl only.

**PR #467 CODEX ROUND 1 = CHANGES REQUIRED (P1) at df5ecb5 — FIXED at head c627901.** P1: changing
governed files MOVES the workflowIdentityHash (hash-of-governed-hashes; OLD=790afbcf..., NEW derived);
the REAL rev-12 suspended state is signed under OLD identity, so after an artifact rebind the gate
fails closed ("bound to a different (stale) workflow identity") — rebind ALONE is insufficient, and my
e2e test masked it by creating fresh state under NEW identity. FIX: added governed, credential-free,
crash-safe `authPr4InitProgression.js --mode identity-transition` — re-signs the EXISTING progression +
anchor OLD->NEW, bound to --oldAuthorizedCommit (old id) + --authorizedCommit (new GRANTED), preserves
key/status/completed-prefix/last-outcome, bumps revision (chained+re-anchored), leaves rollback artifacts
untouched (not identity-bound), fails closed on stale/forged/anchor/marker/lock/txn/reconcile/ledger/
blocking-status/identical-id, NO Firebase/network, explicit --confirmIdentityTransition opt-in. Guard uses
matching --confirmProduction (artifact projectId gates real prod) so emulator regression can run on
demo-authpr4. Tests GREEN: gate 42 (+2 pure transition +1 emulator regression: PRE-change suspended OLD-id
-> proves fail-closed -> transition -> continuation 4->3->2->1->terminal), init 63, migration 31. Docs
corrected: full unwind = 3 separately-authorized steps RE-AUTHORIZATION -> IDENTITY-TRANSITION -> CONTINUATION.
PR #467 DRAFT, 7 files, head c627901, response comment posted.

**PR #467 CODEX ROUND 2 = CHANGES REQUIRED (P1) at c627901 — FIXED at head 6ce375b.** P1: the identity
transition did state-write then anchor-write as TWO independent fs replacements; a crash between left
new-id state N+1 + old anchor N (old state already overwritten) = fail-closed but UNRECOVERABLE (no
journal/predecessor/repair). FIX: journaled crash-safe transition + recovery. identityTransition now
publishes a signed `.idtxn` intent (atomic+exclusive hard-link, full-or-absent) BEFORE touching
state/anchor — carrying authId, old/new ids, predecessor rev/hash + state+anchor DIGESTS, gen(at), and
the EXACT authorized TARGET bytes+digests — then closes the claim race (re-confirm predecessor digest +
no lock/txn), writes state, writes anchor, verifies BOTH under new id, removes intent LAST. Gate blocks
all prod steps while `.idtxn` present (assertNoIdentityTransactionIntent). New `--mode
identity-transition-recover`: verifies signed intent, classifies on-disk state/anchor by digest
(predecessor|target|foreign), deterministically ROLLS FORWARD only a byte-identical-to-predecessor
artifact (never foreign/substituted, never time-inference), verifies together, removes intent;
idempotent + itself crash-recoverable; BLOCKS (retains intent) on foreign/conflicting. Tests: fault
injection at ALL 4 boundaries (intent/state/anchor/cleanup) each recovered (incl Codex's exact
new-state/old-anchor case proven to fail freshness pre-recovery) + no-intent refusal + foreign BLOCK.
Tests GREEN: gate 44, init 63, migration 31. Docs describe the .idtxn journal + recover path.
PR #467 DRAFT, 7 files, head 6ce375b, round-2 response comment posted.

**PR #467 CODEX ROUND 3 = CHANGES REQUIRED (P1) at 6ce375b — FIXED at head 1cc8aa0.** P1: the .idtxn
journal was NOT generation-bound (IDTXN_FIELDS lacked generation; preflight discarded
readGenerationLedger()), so a journal signed under an earlier fencing generation could be replayed
after a governed reconciliation advanced the generation. FIX: gate.generationLedgerHead()->{generation,
headDigest} (head=gen.<K> content digest or GEN_CHAIN_ROOT@0); added signed `generation`+`ledgerHeadDigest`
to IDTXN_FIELDS (captured pre-publish); assertIdentityFence() revalidates current head==intent's after
publication + before EACH state/anchor replacement + before intent cleanup (beforeStateReplace/
beforeAnchorReplace seams); recovery BLOCKS+retains intent on any gen/head mismatch (stale journal +
matching predecessors cannot bypass). Tests: same-gen ok; gen-advance-after-intent blocks recovery;
stale-journal-cannot-bypass; mid-flight gen change fails closed pre-write. GREEN: gate 45, init 63,
migration 31. NOTE: backticks in a git -m message triggered shell cmd-substitution + mangled it — used
git commit -F/heredoc to fix; avoid backticks in -m. PR #467 DRAFT, head 1cc8aa0, round-3 comment posted.

**PR #467 CODEX ROUND 4 = CHANGES REQUIRED (P1) at 1cc8aa0 — FIXED at head 5207e16.** P1:
assertIdentityFence() and the following atomicWrite() are separate syscalls -> a governed reconciliation
could advance the generation in the check->write window and a superseded transition still mutate state.
FIX: the .idtxn intent (owner-published, exclusive, never-auto-broken, held across the whole critical
section) is now the SHARED EXCLUSION LOCK -- claimGeneration() REFUSES while an .idtxn is present, so the
fence cannot advance for the rest of the critical section (race closed by construction, not re-detection).
Capture->publish window still covered by the post-publish pre-write fence check, which WITHDRAWS the intent
on any advance (transition mutates nothing, no residue). Test seams moved into the exact check->write
windows (beforeStateReplace/beforeAnchorReplace/beforeIntentCleanup + beforeIntentPublish). Tests: held
intent refuses claimGeneration; advancement attempt in EVERY window refused + transition completes;
pre-publish advance wins + mutates nothing. Generation-fence test updated to model an OUT-OF-BAND
ledger-head advance (governed claimGeneration refused while intent held). GREEN: gate 46, init 63,
migration 31. PR #467 DRAFT, head 5207e16, round-4 comment posted. Awaiting Codex re-review.
**PR #467 CODEX ROUND 5 = CHANGES REQUIRED (P1) at 5207e16 — FIXED at head cc60a11.** P1: round-4
exclusion was ONE-SIDED (claimGeneration checked .idtxn existence then linked gen.N+1; transition could
publish .idtxn between check and link → both succeed; presence check ≠ mutual exclusion). FIX: ONE
owner-bound `.fencelock` both paths acquire ATOMICALLY (O_EXCL hard-link via atomicExclusiveCreate) +
hold across their whole critical section. reconcile-recover (the ONLY production gen-advance, via
claimGeneration) acquires it "generation-advance" before the gen CAS through mutex removal; identity
transition + recover acquire it "identity-transition" from before intent publish through verify+cleanup.
Exactly one wins (EEXIST for loser → publishes/mutates nothing). Owner-token release (releaseFenceLock),
never auto-broken. New `--mode fence-inspect`/`fence-recover`: crash-left lock cleared ONLY by owner-stopped
attestation (FENCE_RECOVER_CONFIRM "fence-holder-stopped") + matching fingerprint; touches only the lock;
gate blocks production while a .fencelock present (assertNoFenceLock). Kept claimGeneration signature
UNCHANGED (15+ ledger unit tests) — lock is at the OPERATION level (reconcileRecover), not the ledger
primitive. Tests: reverse race both directions + crash-left→fence-recover→run. GREEN: gate 47, init 63,
migration 31. PR #467 DRAFT head cc60a11, round-5 comment posted. Awaiting Codex re-review.

**PR #467 CODEX ROUND 6 = CHANGES REQUIRED (P1) at cc60a11 — FIXED at head 6e3555e.** P1: claimGeneration
still published gen.N WITHOUT verifying a fence-lock token — the shared lock was only a caller convention
(reconcileRecover acquired it, but claimGeneration didn't check). FIX: claimGeneration now REQUIRES
deps.stateKey + deps.fenceToken and, immediately before publishing gen.N, strictly parses+verifies the
signed on-disk fence lock (holder="generation-advance" + exact token + captured generation & ledger-head
digest == current validated head); refuses absent/malformed/foreign/wrong-holder/wrong-token/stale. Removed
the superseded .idtxn presence guard + fixed stale comments. Fence lock now records ledgerHeadDigest; the
transition binds its intent to the head observed UNDER the lock (frozen). reconcileRecover threads its held
token. Tests: lock-owned refusals (no-lock/missing-token/missing-key/wrong-token/wrong-holder/malformed/
stale-gen) + CALL-GRAPH GUARD (grep proves the single production call site threads fenceToken). Big test
churn: ledger+reconcile tests now advance the gen via genAdvance helper (acquire fence lock + token) OR
writeGenClaimDirect (out-of-band advance detected as stale); INTERLEAVE recovery-vs-recovery seams reframed
(serialize at the fence lock, not the gen CAS); mutual-exclusion test reframed to the fence lock. GREEN:
gate 47, init 65, migration 31. PR #467 DRAFT head 6e3555e, round-6 comment posted.

**PR #467 CODEX ROUND 7 = IMPLEMENTATION PASS; one P2 doc-only fix.** Codex confirmed the
implementation has NO remaining implementation/concurrency finding (generation primitive correctly
lock-bound). Only P2: a stale design-doc test-summary bullet still described the superseded .idtxn
presence-check ("while an intent is held claimGeneration refused; pre-publish advance wins"). FIXED
(docs-only) at head **ef4289f** — rewrote to .fencelock ownership (transition holds the shared lock;
generation-advance acquisition refused EEXIST in every window; removed "pre-publish advance wins");
scanned docs, remaining mentions accurate. No code/governed-file/test change. Round-7 comment posted
with new head ef4289f for final PASS.

**PR #467 MERGED 2026-07-28** at reviewed head ef4289f → merge commit
**bc0fda57c9b35a967cef75b3df747a6fac91ec15** = origin/main. Owner authorized the repository-only
RE-AUTHORIZATION prep gate. Prepared **DRAFT PR #468** (branch feat/auth-pr-4-reauthorization-continuation,
worktree D:/Taylor_Parts-worktrees/auth-pr4-reauth, head **5271e98772e1c4520459a8c9e6f931b4e61f3851**,
base main, MERGEABLE, 5 files). Rebinds production-authorization.json to the 3 governed files at bc0fda57:
reviewedHead bc0fda57; hashes migration=9350efb6..., gate=48f4a579..., initializer=a304844b... (via merged
gate's governedHashesAtCommit + independently sha256sum-cross-checked). Preserved id/GRANTED/project/order/
executor/breakGlass/executionModeToken from #52. 3 governed impl files UNCHANGED from #467 (empty diff).
DECISIONS #54 appended (records #467, merge, hashes, intended identity-transition + reverse-order rollback
continuation 4→3→2→1 one-at-a-time to terminal rolled_back, steps A–G separately gated). GRANTED-doc +
runbook binding refs updated to bc0fda57. Gate binding test FLIPPED back to "verifies GRANTED" (+ genesis-
boundary refusal). Artifact VERIFIES GRANTED via gate at HEAD. Tests GREEN: gate 47, init 65, migration 31.
CI ALL PASS (AUTH-PR-4 security suites pass 45s + build pass x2). NOT merged; nothing executed. Reverse
worktree removed (merged). Codex round-1 review of #468 = CHANGES REQUIRED (P1 docs: runbook/test still claimed pre-execution state
[Gate A ungranted, no genesis, missing-genesis boundary] contradicting DECISIONS #54's suspended progression;
+ production-refusal test overclaims — it uses a synthetic temp progression path). I began the doc corrections
(runbook banner→suspended reality; test name→synthetic-temp-path) but was INTERRUPTED before commit.

**OWNER CANCELLED the AUTH-PR-4 reverse-order rollback continuation 2026-07-28.** PR #468 CLOSED + UNMERGED
(closed head 5271e98). Branch feat/auth-pr-4-reauthorization-continuation RETAINED for recoverability — do NOT
reopen/merge/revise/delete without separate Owner authorization. PR #467 remains merged at bc0fda57. I discarded
my uncommitted round-1 doc-scratch in the reauth worktree (branch commit unchanged at 5271e98; worktree clean).

**PRE-BULK-ROLLBACK VERIFICATION (read-only/credential-free) 2026-07-28 = CONFIRMED.** origin/main=bc0fda57;
PR #468 CLOSED/unmerged/head 5271e98; main's authorization NOT rebound (still reviewedHead dba0e33 + old #53
hashes). Governed reconcile-inspect (from a read-only 49af756 detached worktree, removed after) on the protected
progression: markerPresent/lockPresent/txnPresent/reconcileMutexPresent all FALSE, generation 0,
reconciliationNeeded false, artifacts [anchor,state], **fingerprint 2a461a97... = EXACT match to the recorded
post-position-5-rollback state** (state+anchor byte-identical → still suspended/rev12/completed 1-4/last-outcome
position-5 rollback/NOT rolled_back/no continuation of 4-3-2-1), **workflowIdentityRef 790afbcf (OLD identity →
no transition re-signed it)**. idtxn journal + fence lock ABSENT. Protected env: state+anchor+state_key present,
4 rollback artifacts, all owner-only (inheritance-removed). NOTE: reconcile-inspect does NOT decode
revision/status/completed fields — those are confirmed transitively via the exact fingerprint match to the
previously-verified post-rollback state, not re-decoded.

**SESSION-STATE RECONCILIATION + NEXT-GATE (Owner-authorized) 2026-07-28.** Owner authorized (1) a Customer
session-state reconciliation PR and (2) a next Customer/Auth code-gate proposal (no implementation). (1)
DRAFT **PR #473** (branch docs/customer-session-state-authpr4-cancellation, head cad21c9, base main 3591fa8):
reconciled CUSTOMER/COORDINATION/PLATFORM session-state (NOT INVENTORY) from stale "AUTH-PR-4 not executed"
to the real closure (Gate A/B executed, suspended rev12, positions 1-4 migrated, #468 CLOSED, continuation
CANCELLED); no secrets/paths committed; small (+6/-5,+6/-8,+6/-5). (2) NEXT-GATE FINDING: both active
Customer/Auth lanes are at PRODUCTION gates — admin-reset roadmap (AUTH-UI-1/2/3 + AUTH-PR-3.5 all merged
#469-#472) next = AUTH-PROD-1 (real-Firebase verify, Owner prod auth, hard-stop); enterprise-access #226
open rows are all 19-31 (production/deploy/end-of-sequence). The next REPOSITORY-ONLY Customer/Auth code gate
= **Epic 5 Procurement/Supplier permission-catalog gap** (spec §26.4/§27 explicitly flags purchase_orders/
suppliers/supplier_catalog as a still-open catalog gap for a future addendum), following the inert/additive
Row 1a/1b pattern. Unresolved Owner decision: whether to assess Procurement next + Purchasing-vs-Warehouse
governed-role boundary. NOT started (needs separate authorization). Standing boundary: preserve the
dev-only test-email exception + its warning; full email protections restored under a separate reviewed gate
before whole-project production deploy.

SIX Codex P1 rounds, each a real defect: (1) stale-workflow-identity → identity transition; (2)
non-crash-safe two-file write → journaled .idtxn intent + recovery; (3) not generation-bound → fence
binding; (4) check/write race → guard; (5) one-sided guard → shared atomic .fencelock + fence-recover; (6)
claimGeneration not lock-bound → primitive verifies the fence token + captured gen/head. NEXT (all separate,
none authorized): Codex re-review → re-authorization PR (rebind artifact to new hashes) → identity
transition run (+recover if interrupted) → continuation exec to restore positions 1-4.

AUTH-PR-4 production migration (see [[project_auth_pr4_workstream]]): PR #461 (branch
feat/auth-pr-4-genesis-initializer, worktree D:/Taylor_Parts-worktrees/auth-pr4-initprog)
adds the governed, credential-free genesis initializer `functions/scripts/authPr4InitProgression.js`
+ its test + runbook `docs/deployment/auth-pr-4-production-authorization-GRANTED.md`. It
expands the gate's GOVERNED_FILES to **3**, which invalidates the 2-file GRANTED
authorization → `production-authorization.json` left UNCHANGED/stale (fail-closed); a
SEPARATE 3-file re-authorization PR is gated on #461 merging (NOT prepared, NOT authorized).

**Owner authorized (Codex re-review 5) a full redesign** of the reconciliation subsystem as
one governed state machine (states CLEAN/INITIALIZED/INIT_INTERRUPTED/RECONCILING/BLOCKED).
Key design after 5 Codex rounds:
- Reconcile modes: `--mode reconcile-inspect|reconcile-cleanup|reconcile-recover` (default = init).
- Fencing generation = append-only ledger of immutable O_EXCL claim files `<prog>.gen.<N>`;
  current gen = highest N; advance G→G+1 is single-winner CAS (O_EXCL). Replaced the earlier
  mutable-fence file (which was a non-CAS lost-update bug).
- Recovery: CAS-acquire authority, bind to EXACT inspected mutex (content digest + fingerprint
  re-check immediately before removal), never unlink a mutex it didn't inspect; requires
  `--confirmOwnerStopped prior-cleanup-stopped` (NO age/malformed inference) + `--confirmReconciliation recover-mutex` + fingerprint; crash-recoverable.
- Cleanup: atomic exclusive mutex publication (temp+fsync+hard-link, complete-or-absent);
  per-target digest recheck immediately before unlink; marker-last deletion (self-healing);
  confined to marker/state/anchor.
- HONEST boundary guarantee (Codex #5): digest binding is the hard guarantee (superseded
  cleanup deletes only the exact byte-identical inspected artifact, never newer); generation
  fencing = defense in depth; Owner-stopped attestation = primary operational exclusion.

Generation fencing is now a GATE-OWNED, hash-chained, contiguous, content-validated ledger
(`<prog>.gen.<N>`, staged outside namespace via `<prog>.genstage-*`); `gate.readGenerationLedger`
is the single authority and `assertProductionAuthorization` enforces it. Recovery: single-winner
O_EXCL CAS advance + exact-mutex digest binding; cleanup fenced by per-op ownership+generation
revalidation; honest destructive-boundary doc (digest binding = hard guarantee, fencing = defense
in depth, Owner-stopped attestation = primary exclusion).

**MERGED 2026-07-28** (Owner-authorized) at exact reviewed head bf393ba → merge commit
**dba0e33bd5f009c4374b8985af3a101d0d1e7777** on main (parents: merge-base 70c3989 + bf393ba;
6 reviewed files byte-identical on main; production-authorization.json UNCHANGED/stale). Remote
feature branch feat/auth-pr-4-genesis-initializer auto-deleted on merge. Local worktree
D:/Taylor_Parts-worktrees/auth-pr4-initprog still exists (branch merged; safe to remove).

**Codex PASS at head bf393ba688068c54e49911be44a2ea0862fd06b4** (2026-07-28) — PASS binds ONLY
to that exact SHA; any drift needs re-review. Ledger findings 1-4 fixed at 8e02512; readGenerationLedger
fail-OPEN blocker fixed at bf393ba (only ENOENT=clean-start returns 0; EACCES/EPERM/EIO/other throw
sanitized/path-free). Suites: init 63, gate 27, migration 21 — all green; 13/13 CI PASS. PR DRAFT/MERGEABLE,
base main, no drift (origin/main=merge-base 70c3989).

THREE-FILE RE-AUTHORIZATION (Owner-authorized 2026-07-28, DECISIONS #53): DRAFT PR #462
(branch feat/auth-pr-4-reauthorization-three-file, worktree D:/Taylor_Parts-worktrees/auth-pr4-reauth,
head **0620878279a615ddba1a5a3ae4321fb1696a86ea**, base main, no drift). Rebinds
production-authorization.json to reviewedHead dba0e33 + 3 governed blob hashes (migration 779410d6
unchanged, gate ec140a0a changed, initializer 4b77b778 new); preserved id/GRANTED/project/order/
executor/breakGlass/executionModeToken. Committed artifact VERIFIES end-to-end at HEAD (GRANTED, 3 files);
gate test proves verify + fail-closed on missing/substituted/stale/drifted. 4 files only (artifact,
DECISIONS #53, runbook banner/§1/§7, gate test). Suites gate 27/init 63/migration 21. Awaiting Codex review.

CI-ENFORCEMENT PREREQUISITE (Codex PR #462 review required it FIRST): DRAFT PR #463
(branch ci/auth-pr-4-security-suite-enforcement, worktree D:/Taylor_Parts-worktrees/auth-pr4-ci,
head **e9a5b34e9811c4aa82b80d4e70282465d650cf1f**). Adds .github/workflows/authpr4-security-tests.yml
running init+gate+migration suites, with gate/migration Auth-emulator layers under the Auth emulator
on demo-authpr4 ONLY (offline); path-triggered on the 3 governed scripts+artifact+3 tests+package+
firebase.json+workflow. Needed fetch-depth:0 (gate tests do git-ancestry/blob-hash checks on historical
commits; shallow clone failed). CI GREEN: init 63, gate 34 (27 pure+7 emulator), migration 30 (21 pure+
9 emulator) — FIRST time the emulator layer runs in CI. Also carries the P2 break-glass flake fix.

#462 CORRECTIONS (Codex P1/P2): head now 3be2402 — removed false "Codex PASS" wording (DECISIONS #53
+ runbook say "Codex-reviewed"); P2 flake fix; updated the emulator-layer refusal test for the now-valid
artifact (fails at missing-genesis boundary, CI-validated after rebase).

#463 MERGED 2026-07-28 (Owner-directed) → merge commit **9b912d7a750eefeb8d9bd6ffc77787c43b00864e**
on main (parents dba0e33 + e9a5b34); remote branch auto-deleted, CI worktree removed. The AUTH-PR-4
security workflow now runs on main. #462 REBASED onto 9b912d7 → new head **52f9839a7ecf8f6926d57d06a58aee9c7e90400d**
(4-file scope intact; 3 governed scripts byte-UNCHANGED from dba0e33; artifact hashes independently
recomputed + verify GRANTED/3-file; wording corrected to "#461 post-merge review CHANGES REQUIRED,
CI enforcement corrected by #463", no "Codex PASS" claim). Awaiting #462 CI (AUTH-PR-4 workflow now
runs on it) + Codex re-review + Owner merge.

**PR #462 MERGED 2026-07-28** (explicit Owner authorization at head 52f9839) → merge commit
**602ed1f9e3e3c0cceb6025cc547b91972630f747** on main (parents: base 24573ae [unrelated Equipment
Compatibility merge, touched NO governed files] + authorized 52f9839). Re-bound artifact VERIFIES
LIVE at HEAD 602ed1f: GRANTED, reviewedHead dba0e33, 3 files, hashes match derived. Remote+local
reauth branch deleted; both AUTH-PR-4 worktrees (reauth + stale initprog) removed; no auth-pr-4
branches/worktrees remain. The three-file authorization is now current on main and verifies.

CODEX SEQUENCE COMPLETE: merge #463 ✓ → rebase #462 ✓ → Codex PASS #462 ✓ → Owner-authorized merge #462 ✓.

EXECUTION-READINESS RECONCILIATION (2026-07-28, read-only): verified origin/main=602ed1f, artifact
verifies GRANTED/3-file, AUTH-PR-4 security CI green on main, no open PR touches governed files, no
private inputs in repo. Found the 3 session-state files (CUSTOMER/PLATFORM/COORDINATION) badly stale
(said NOT AUTHORIZED/PENDING) → corrected via docs-only DRAFT **PR #464** (head 659f6e4, branch
docs/auth-pr-4-session-state-reconcile, worktree D:/Taylor_Parts-worktrees/auth-pr4-sessionstate). Also
flagged: docs/operations/auth-pr-4-operator-workflow.md still says "committed artifact is PENDING"
(stale, but NOT session-state so left for Owner). Defined two future Owner gates: Gate A (protected
genesis prep via authPr4InitProgression.js) + Gate B (one-persona execution, position 1 first). NEITHER
authorized. Delivered readiness report + Gate A / Gate B-position-1 authorization statements for Codex.
**PR #464 (docs reconciliation, 4 files: 3 session-state + operator-workflow) Codex PASS at head
98a4f5b7c440760c5f4223c36f9e3319c14f3949 (2026-07-28)** after 2 correction rounds (operator-workflow
stale GRANTED/PENDING wording; sanitizeEvidence-exact evidence schema; USE-vs-COMMITMENT + split gate
boundaries). **#464 MERGED 2026-07-28** (Owner-authorized, docs-only) → merge commit
**a2b7a52fa72fa3f8d36bf135b77a025e911be8f4** = origin/main (parents 602ed1f + 98a4f5b); remote+local
branch deleted, worktree removed — NO auth-pr4 worktrees/branches remain. Governance docs now reconciled
to reality. Gate A/Gate B still UNAUTHORIZED (merge authorized/executed nothing). Next = separate Owner
Gate A authorization (protected genesis prep), then separate Gate B position-1 authorization.

STATE NOW: authorization GRANTED + verifying (3-file). Production execution NOT started and NOT
authorized — merging changed nothing in production. NEXT (separate future gates, none granted): the
out-of-band genesis/state-key creation + one-persona-at-a-time execution per #52/§5. I must NOT
create a state key/genesis, request private mappings/credentials, dry-run, or execute until a
distinct Owner authorization for THAT.
NOT authorized: merge either PR; create state key/genesis; private inputs; dry-run/mutation; any
Auth/email/session/provider/project/role/claim/Firestore change; Inventory/Equipment. Production stays
DISABLED; execution is a further separate gate (#52/§5).
Run tests with NODE_PATH=D:/Taylor_Parts/functions/node_modules.

NOT authorized until Codex PASS + Owner merge: merge, re-auth PR, GRANTED update, genesis
creation, private inputs, production mutation, position-1 execution. Keep PR DRAFT + fail-closed.
