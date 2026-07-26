# INV-CONVERGENCE-E Stage A — Decision #44 live pre-cutover parity — verification summary

Deployed diagnostic build commit: `73d9e1b07f13c7f42cc525c3c037dec6b47d289d` (build id `73d9e1b`). Repository baseline: `origin/main` @ `039e7c540aa476cbbfefd193c4a7fd4a0dbab408`.

| # | Assertion | Result | Source |
|---|---|---|---|
| 1 | Exact deployed commit confirmed (`73d9e1b07f…b408`) | **PASS** | operator (hosting-deploy.txt) |
| 2 | Clean detached checkout confirmed | **PASS** | operator |
| 3 | Rendered/served build id equals `73d9e1b` | **PASS** | operator (hosting-deploy.txt) |
| 4 | Hosting-only deployment succeeded (exit 0) | **PASS** | operator (hosting-deploy.txt) |
| 5 | Governed **repository** Rules hash equals `fda242399023b400c0f441b96e4103fc86f79f18e2bf04005cbc745e3785bac7` | **PASS** | independently recomputed (`git show 73d9e1b:firestore.rules \| sha256sum`) |
| 6 | Postdeploy **live** Rules hash equals predeploy **live** Rules hash (`a17f791d…b46b4bd8`) | **PASS** | operator (pre/postdeploy-live-rules-hash.txt) |
| 7 | Postdeploy Functions inventory equals predeploy Functions inventory | **PASS** | operator (pre/postdeploy-functions.txt) |
| 8 | No Rules deployment occurred | **PASS** | operator + scope (`--only hosting`) |
| 9 | No Functions deployment occurred | **PASS** | operator + scope |
| 10 | No index deployment occurred | **PASS** | operator + scope |
| 11 | No data modification occurred | **PASS** | operator + scope |
| 12 | A–E authorization matrix complete and PASS | **PASS** | Owner-confirmed (route-authorization-matrix.md) |
| 13 | Live diagnostic status equals PASS | **PASS** | live-pass.json |
| 14 | canonicalMatch equals 190 | **PASS** | live-pass.json |
| 15 | staticOnlyExcluded equals 10 | **PASS** | live-pass.json |
| 16 | Every divergence/issue count equals 0 (rowMissing, field, availability, workflow, unexpectedUnmatched, structuralIssue) | **PASS** | live-pass.json |
| 17 | `capturedAtStart` and `capturedAtEnd` are non-null | **PASS** | live-pass.json |
| 18 | `sourceCounts` is complete (canonical/static/ledger/reorder/po) | **PASS** | live-pass.json |
| 19 | Evidence contains no credentials, tokens, UIDs, emails, reset links, secrets, or raw production records | **PASS** | authoring + sanitized capture |

**Artifact-type distinction (do not conflate):** the governed **repository** Rules hash (`fda2423…5bac7`) and the **live** production Rules ruleset export hash (`a17f791d…b46b4bd8`) are **different artifact types** and are **not** asserted to be equal. The Rules-unchanged proof is assertion #6 (postdeploy live == predeploy live) together with assertion #5 (repository hash == governed expected value).

**Outcome:** all assertions PASS. The build-`73d9e1b` live run is the qualifying Decision #44 pre-cutover parity artifact. Stage A remains a diagnostic, non-authoritative gate; this evidence authorizes no consumer source switch or PartsList/PartDetail cutover.
