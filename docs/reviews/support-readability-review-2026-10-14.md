# Support-Readability Review: Surviving EOS Code

- **Date:** 2026-10-14
- **Code reviewed at:** `fc8baf26`
- **Rubric:** [support-readability-rubric.md](../engineering/support-readability-rubric.md)
- **Pilot:** [support-readability-pilot-work-orders-2026-10-14.md](support-readability-pilot-work-orders-2026-10-14.md)
- **All findings:** [support-readability-findings-2026-10-14.csv](support-readability-findings-2026-10-14.csv), 817 rows,
  one per finding, with severity, area, file:lines, rubric section, fix class and verification result.

Findings only. No code was changed.

## Scope and method

| Tier | Scope | How |
|---|---|---|
| A: Scripted scan | All surviving source: 1,390 files, 288k lines (source minus Firebase-importing files and migration tooling) | Per-file counts of banners, undefined codes, ruling bookkeeping, Firebase mentions, PR references and comment share; a duplicate-helper census |
| B: Deep review | The API (`functions/src`, except the piloted work-order files) and the client's non-UI code (`domain/`, `access/`, `services/`, `auth/`, `navigation/`, `offline/`, `config/`): 876 files, 188k lines | 19 `design-code-reviewer` agents of about 10k lines each, every file read in full |
| C: Sample | Client UI (`modules/`, `metadata/`, `shared/`, `hooks/`): every 10th file, 49 files, 9.6k lines | 2 reviewer agents |

Every S1 claim then went to an independent skeptic. The skeptic was told to refute it and to search the
whole repo before accepting that a cited file or test was missing. Of 268 S1 claims, 179 held as S1,
84 were real but downgraded, and 5 were refuted (2 of those rejected outright). Total cost: 42 agents,
7.9M tokens, 14 minutes.

**Coverage limits:** 82 notes in the agents' `notReviewed` lists. The main gaps:
- Generated tables were skimmed rather than read line by line (`permissionCatalog.ts`, seed JSON).
- Most "a test pins this" claims were checked for the test file's existence, not its contents.
- 140 files were classified as Firebase-era and retiring, so they got a verdict but no findings.

## Headline

**The code is generally careful; its comments often aren't true.** Reviewers repeatedly praised the
fail-closed design, the explicit unknown-versus-empty states, and the refusal vocabularies. The risk for a
support engineer is the prose around that code:

| Severity | Count | What it means here |
|---|---|---|
| **S1: Misleads** | **179** (all verified) | 63 describe current code in Firebase/Firestore terms; 38 say a module is "inert / not wired / INACTIVE" when it is live (or the reverse); 20 cite a test, file or symbol that doesn't exist; 14 put governance or deployment text into strings that users or audit rows see |
| **S2: Blocks** | 286 | Copies that drift, mirrors with no pinning test, dead or test-only modules sitting beside live ones, undocumented error contracts |
| **S3: Slows** | 312 | Banners, ruling and date bookkeeping, undefined codes, history narration |
| **S4: Polish** | 40 | Names, detached JSDoc, import style |

By fix class, 482 findings are **mechanical** (comment and text edits) and 335 are **structural**.

## Tier A: Scripted scan (all 288k lines)

| Signal | Count |
|---|---|
| Banner lines (`════`) | 1,231 |
| Undefined governance codes (`DQ-`, `ND-`, `OD-`, `FBR-`…) | 490 |
| Ruling/authorization bookkeeping lines | 558 |
| Firebase/Firestore mentions in code that survives the exit | 934 |
| PR/Decision/Issue number references | 342 |
| Files over 1,000 lines | 19 |
| Files over 100 lines with ≥40% comments | 179 |

The top offenders by combined signal are `navConfig.js` (1,925 lines, 61% comments), both copies of
`governedBusinessRoles.ts` (about 2,045 lines each), `App.jsx`, `policyCommands.ts` (2,211 lines),
`PartDetail.jsx` and `catalogActivationLedger.ts`.

**Duplicated helpers** (top-level definitions with the same name in 5 or more surviving files): `refuse` (56),
`isPlainObject` (56), `isNonEmptyString` (34), `nonEmpty` (32), `str` (27), `ID_SHAPE` (21), `failure`
(19), `isInt` (17), `newIdempotencyKey` (11), `canonicalJson` (10), `acceptOnly` (10). Reviewers confirmed
that the copies have **drifted**:
- the ID pattern allows 128, 200 or 255 characters depending on the copy;
- `inTransaction` sometimes has a rollback catch and sometimes doesn't;
- only some copies map Postgres `23505` to CONFLICT;
- the `refuse` category unions differ.

**Client/server mirrors** (the same file in both trees): `governedBusinessRoles`, `permissionCatalog`,
`compatibilityRoles`, `resolveEffectivePermission`, `legacyAuthorizationSurface`, `partsCatalog`,
`compactClaims`, `bindingScopePolicy`, `shadowParityHarness`. They are generated from `functions/src/access`,
so fixes go to the server copy, but most files don't say so.

## What a support engineer would trip over

### 1. Stale "not wired" and "not yet activated" statements (S1, 38 and more)
Activation flags flipped to ACTIVE, but the headers still describe the system before activation. It
happens in both directions:
- `warehouseBinRepository.ts` says it is "NOT wired" but is live.
- `catalogHttp.ts` says mutations are held, but the hold is lifted.
- `opportunityWriteReadiness.js` says the write path is "INERT", and its user-facing reason still says
  "command not deployed".
- `inventoryCommitmentRepository.ts` and `invoiceAuthority.ts` really are orphaned, but nothing says so.

Writer-state constants that can only ever be ACTIVE keep dead `NOT_ACTIVATED` branches alive in the
request path. The pilot found the same pattern in `workOrderWriterState.ts`.

### 2. Code described against Firebase (S1, 63)
The client error language is still Firebase's (`permission-denied`, the `functions/` prefix). That leaves
**three error vocabularies** for one API envelope: EOS categories, Firebase codes, and per-client
translation tables. Headers say "same as the Firestore command" or "port of the callable" about live EOS
code. Several mirrors are pinned only to Firebase files that the retirement will delete, so the pin
disappears with them.

### 3. Citations to things that don't exist (S1, 20)
Examples:
- `personaNavigationProjection.test.mjs`, `typedOwner.test.mjs`, `operatingCompanyAuthority.test.mjs`,
  `acquireParity` and `supplierAdministrationParity` tests;
- `useOpportunityCapabilities.js` and `useSalesOrderCapabilities.js` hooks;
- `serializedAssetReadCallableClient.js`;
- line-number citations into other files that have already rotted.

### 4. Governance text reaching users (S1, 14 flagged)
- Role `description` strings in `governedBusinessRoles.ts` are seeded into the role table and shown on the
  Administration roles screen. Some contradict the grants listed below them.
- Refusal messages interpolate `ruling` constants (`adminPolicy`, `responsibility/*`, `sales*Commands.ts`).
- UI copy says "built but inactive", "not activated on EOS yet" or "(NOT_YET_ACTIVATED)".

These are behavior changes, not comment edits, so each needs a UI and test check.

### 5. Copies with nothing keeping them in sync (S2)
Status enums and transition tables have 3 or more copies (part status, tracking mode, Work Order status
groups, truck status). Limits are restated in several files: the 16-hour labor bound, the 500- and
2,000-character caps, page sizes. The HTTP transport (fetch, bearer token, error envelope) is
**copy-pasted in 11+ client service files** with different status maps. The Commercial and CRM kernels
re-implement each other's error class, cursor, paging and membership SQL.

### 6. Dead, test-only and cutover code mixed with live code (S2)
The modules include:
- one-off activation "delta" manifests;
- AI verifier skeletons;
- cutover snapshots (`crmCutoverSnapshot`);
- seed and backfill tools;
- `Legacy*` components;
- an unimported `controlTower/WorkOrderDetail.jsx`.

Most of them have only test consumers and sit in `src/` with no marker. A newcomer can't tell which half
of a folder survives. 140 files were classified as Firebase-era retiring code; the list is in the CSV
(`area` column) and the reviewers' file verdicts.

### 7. Safety rules enforced but never stated (rubric §4, 175 notes)
The most frequent themes:
- **tenant and operating-company scoping** (49): the tenant comes from the verified caller, never from
  input;
- **retry semantics** (31): which error codes are safe to retry;
- **lock order** (25): which lock is taken first when a command takes several;
- **idempotency key scope** (23): it differs between commands (per Work Order, per Principal, global);
- **error-category meaning** (22).

These are the facts a support engineer most needs and is least likely to find.

### 8. File size
19 files are over 1,000 lines; the worst are `policyCommands.ts` (2,211), `trustedWriterCommands.ts`
(2,263), `PartDetail.jsx` (2,078), the two `governedBusinessRoles` (about 2,045 each), `navConfig.js`
(1,925), `eosLoginService.ts` (1,868, which mixes login, MFA, sessions, tenant switching and retention)
and `adminPolicyApi.ts` (1,627).

## Where the problems are

S1 / S2 / S3 / S4 by area, top 12:

| Area | S1 | S2 | S3 | S4 |
|---|---|---|---|---|
| client `domain/` | 31 | 64 | 58 | 6 |
| api `eosOps` (excluding pilot) | 21 | 47 | 48 | 9 |
| api `adminPolicy` | 13 | 30 | 30 | 4 |
| api `eosWorkforce` | 12 | 12 | 16 | 1 |
| client `access/` | 10 | 5 | 11 | 0 |
| api `access` | 9 | 4 | 6 | 0 |
| client `modules/` (sample) | 7 | 10 | 10 | 2 |
| client `services/` | 5 | 8 | 14 | 1 |
| api `eosCommercial` | 6 | 5 | 10 | 0 |
| api `eosFinance` | 3 | 12 | 7 | 0 |
| api `catalogMaster` | 4 | 6 | 4 | 0 |
| api `eosAuth` | 4 | 3 | 7 | 2 |

**Tier C sample verdict:** the UI sample had 11 S1 and 16 S2 findings in 49 files. That is denser than
expected, concentrated in `hooks/`, `shared/search`, `shared/inventory` and `metadata/definitions/`. **A
deep review of `hooks/` and `metadata/` (about 25k lines, 3 agents) is warranted.** The rest of `modules/`
can wait for its own Firebase-exit pass.

## Models to copy

Reviewers named these as already meeting the rubric:
- **API:** `workOrderRecordRead.ts`, `workOrderNumbering.ts`, `mobileStockAuthority.ts`,
  `governedFieldGroups.ts`, `functionalRoleFacts.ts`, `requestText.ts`, `workflowAuthority.ts`,
  `providerTransport.ts`, `partAliasScanCore.ts`, `inboundRouting.ts`.
- **Client:** `stockMovementSession.js`, `scanInputPolicy.js`, `reportingPeriod.js` (it names its pinning
  test), `workOrderListSource.js`, `objectSecurityReadModel.js`, `StatusPill.jsx`.

## Recommended fix plan

This is for Owner approval; nothing has started. The steps are ordered by risk to a support engineer
against the cost of the fix.

1. **S1 comment corrections, one PR per area** (mechanical, about 150 of the 179). They are cheap and
   remove the misleading statements first. Start with `eosOps`, `adminPolicy` and client `domain/`.
2. **User-visible governance text** (the 14 runtime-text S1s plus role descriptions): one PR, with UI and
   test checks, because API and UI strings change.
3. **Write down the safety rules once per area**: tenant scoping, retry/error categories, lock order and
   idempotency scope, as a short **Invariants** block at each route table (`eosOpsHttp.ts`,
   `adminPolicyApi.ts`, the commercial and CRM kernels), plus one maintainer page. This is the highest
   value for support staff per line written.
4. **Shared helper modules** (structural): one API `eosCommon` (ID shape, `refuse`/error class,
   `inTransaction` with the documented `23505` mapping, audit insert, `canonicalJson`) and one client
   `eosHttpClient` transport. This replaces about 200 copies and resolves the drift findings. Do it one
   domain at a time, with tests showing behavior is unchanged.
5. **Delete dead code and set writer-state constants to their final value** (structural), after a
   consumer search across `src`, `scripts` and tests for each item.
6. **Scripted noise removal** (banners, bookkeeping, undefined codes, Firebase history) per area, **after
   that area's Firebase retirement lands**, so headers aren't rewritten twice.
7. **Split the 1,000+ line files** along business actions, starting with `eosLoginService.ts` and
   `policyCommands.ts`.

Follow-up review: `hooks/` and `metadata/`, as above.
