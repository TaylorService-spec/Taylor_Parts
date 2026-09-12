# P3-B3 executed evidence

Reproduces every `EXECUTED_PASS` / `EXECUTED_FAIL` row in the P3-B3 activity library.

Both probes load the SHIPPED access resolver and the UNMODIFIED `config/environments.json`
and evaluate capability resolution purely. No network, no Firestore, no Postgres, no deploy,
no mutation of any kind. They need no `node_modules` — they run under Node 22 type-stripping
with a small extensionless-import resolver hook (`tsres.mjs`).

    cd <repo root>
    S=$(pwd)/docs/activities/p3b3-evidence
    node --experimental-strip-types \
      --import "data:text/javascript,import{register}from'node:module';import{pathToFileURL}from'node:url';register('$S/tsres.mjs',pathToFileURL('./'));" \
      $S/probe.mts

    # and the same invocation for matrix.mts

Note: both files hardcode the worktree path
`/home/rudy2/.local/share/eos-worktrees/p3b3-act-sales`; change the `W` constant to run
elsewhere.

| File | What it does |
|---|---|
| `probe.mts` | 52 named `(role, capability)` cases under the production and `platform-sandbox` activation sets |
| `matrix.mts` | All 48 roles x all 147 capabilities under both sets; emits the aggregate findings |
| `tsres.mjs` | Node loader hook resolving the repository's extensionless TS imports |
| `probe-run.txt` | Recorded output of `probe.mts` |
| `matrix-run.txt` | Recorded output of `matrix.mts` |
| `mirror-diff-run.txt` | Recorded output of the five-file mirror-parity `diff` (`P3B3-ADMIN-048`, `P3B3-MGMT-044`), added by lane P3-DIL-FIX |

## Correction, lane P3-DIL-FIX (2026-09-12)

`P3B3-ADMIN-048` and `P3B3-MGMT-044` shipped as `EXECUTED_PASS` with **no committed transcript
at all**. Their command is a literal, deterministic `diff` over files already committed on this
branch, so it was re-run and recorded as `mirror-diff-run.txt`; it reproduces both rows'
claims exactly. `probe.mts` and `matrix.mts` were **not** re-run — they resolve against a
capability catalog that PR #1898 may change, so a fresh run would measure an unsettled tree
rather than reproduce the recorded one.

**What these transcripts do and do not anchor.** `matrix.mts` prints only aggregates plus the
21 admin/owner-only ids and the 17 dead-in-every-environment ids; its per-capability detail
(`holders`, `prodAllow`, `sandboxAllow`, `holderCount`) goes to an **uncommitted** scratchpad
`matrix.json` and is anchored by nothing here. `probe.mts` prints exactly its 52 fixed
`(role, capability)` cases and `probe-run.txt` contains exactly those 52 rows. Neither script
emits the string `109 of 147` — that figure is a source count of `permissionCatalog.ts`
(re-derived as 109 `active: false` of 147 entries), tier `TRACED`. Every
`execution.output` line in the six activity JSON files now carries its own tier in
`execution.output_evidence_tiers`; see §8.1 of the companion markdown.
