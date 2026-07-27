# C1 PartsList — Hosting-only Production Deployment: RESULT

Executed by the operator in authenticated Cloud Shell per
`docs/operations/inv-convergence-e-c1-hosting-deploy-handoff.md` (runbook head
`2f9d17c`; final review PASS). The Inventory session performed no production action
and holds no production credentials; the values below are the operator's **sanitized**
report, transcribed into governed evidence. The operator-created Cloud Shell archive is
referenced by SHA-256 in `operator-evidence-pointer.txt` — it is NOT downloaded, NOT
committed, and NOT immutable (mutable Cloud Shell storage; retention is a known
limitation); the committed sanitized transcription here is the evidence for review.

## Deployment — SUCCESS
- Firebase project: `taylor-parts`
- Scope: **Hosting only** (Firebase reported upload → version finalization → release complete)
- Authorized source commit: `3827ce370b26af7cbf66acdf391267a0afa4092c`
- No Rules / Functions / index / Firestore data / Firebase Auth / identity / role / claim mutation occurred.

## Clean preflight — PASS
Exact-commit + clean checkout; full client tests PASS; lint 0 errors; typecheck PASS;
`build:firebase` PASS; build-base verification 12/12.

## Release evidence
- Predeploy (pinned rollback) version: `sites/taylor-parts/versions/9d0fea79fe66f7c9`
- Postdeploy version:                  `sites/taylor-parts/versions/0bd9029d010914b7`
- Strict normalized-release-field validation: PASS (both)
- New-release inequality (postdeploy != predeploy): PASS

## Live build correspondence
- Live asset: `/assets/index-BJCJSmRw.js`
- Content type: `text/javascript; charset=utf-8`
- Bytes: 1,233,385
- SHA-256: `de96be221d650b258cb5efb4d6c48c91011767b8f2c36dc5887fbb84866ae658`
- Exact Cloud Shell build-manifest match: **PASS** (live bytes == authorized-commit build)
- Live GitHub-Pages host-path occurrences: **0**

## Deployment scope — unchanged assertions
- Governed/live Rules SHA-256: `cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381`
  · Rules pre/post: **IDENTICAL** (RULES-UNCHANGED)
- Normalized Functions inventory SHA-256: `011020f83d188ff578ed1fdeba40d48f2075be929ab0b28e3975221363820fab`
  · Functions pre/post: **IDENTICAL** (FUNCTIONS-UNCHANGED)
- Operator sensitive scan: PASS · evidence checksum verification: PASS
