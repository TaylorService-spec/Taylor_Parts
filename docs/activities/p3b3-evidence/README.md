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
