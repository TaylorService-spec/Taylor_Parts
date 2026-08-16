# Sandbox convergence state — platform-sandbox, 2026-08-16

Evidence-based record of what is actually live in `eos-platform-sandbox`, produced by
reading the live environment rather than by inferring from merge history. Merged is not
deployed; deployed is not activated; activated is not authorized.

Anchor: `origin/main` = `70b314bf`.

## Convergence status

| Layer | Status | Evidence |
|---|---|---|
| Hosting | **CONVERGED** | `/version.json` -> `{"commit":"70b314bf","environmentId":"platform-sandbox","environmentRole":"sandbox"}`; `checkDeployedVersions.mjs --expected 70b314bf` -> "no drift observed" |
| Indexes | **CONVERGED** | `firebase firestore:indexes` -> 8 live; `firestore.indexes.json` -> 8 declared; includes `serialized_assets(partId, currentLocationId, inventoryState)` |
| Rules | **CONVERGED** | Live ruleset `c238f983-59aa-4e77-a506-52108366087d` fetched via the Firebase Rules API; its `source.files[0].content` is **byte-identical** to repo `firestore.rules`. Both hash to `4605a7f0775986da7b087abcbab00c53d7dde6e0167ff2a3dd223208263bd1cf`, which equals the pinned `GOVERNED_RULES_SHA256`. |
| Functions | **NOT CONVERGED** | 79 live vs 82 exported by `functions/src/index.ts` |
| Activation | Declared correct, **not live-verified** | `config/environments.json` and the embedded `ENVIRONMENT_ACTIVATION_REGISTRY` both carry the same 27 override ids (parity test-enforced). Live confirmation requires an authenticated call, which is blocked behind the Functions gap. |
| Authorization | **REPO-COMPLETE, NOT DEPLOYED** | Roles exist in the catalog as of `70b314bf`; the deployed Functions bundle predates them. |

## The Functions gap

Three callables exist in the repo and are absent from the live estate:

- `createCrmActivity`
- `getCrmActivities`
- `getAvailableEquipment`

Derived from compiled truth (`functions/lib/index.js` contains all three; `npm run build`
clean) compared against `firebase functions:list --project eos-platform-sandbox`.

The 12 callables added by the consolidated promotion ARE live and on `nodejs22`:
`listOpportunitiesForAccount`, `listSalesOrdersForAccount`, `listCoordinatedOperations`,
`getLocationDisplay`, `createTransferOrder`, `dispatchTransferOrder`, `receiveTransferOrder`,
`cancelTransferOrder`, `createCycleCount`, `submitCycleCount`, `reconcileCycleCount`,
`cancelCycleCount`. The remaining 67 live functions are on `nodejs20`.

In addition, the three Roles merged in `70b314bf`
(`inventoryTransferOperator`, `inventoryCycleCountCounter`, `inventoryCycleCountReconciler`)
ship inside the Functions bundle. Until Functions are redeployed they do not exist to the
live authorization resolver, so those eight capabilities remain ungrantable **in the live
sandbox** even though the repo can now express the grant.

### Why it is not converged

`firebase deploy --only functions:...` is refused by the agent harness's command classifier.
This is an environmental block on the agent session, not a Firebase/IAM/org-policy failure and
not a missing-authorization finding — the Owner authorized sandbox deployment for this work.
No wrapper was written to route around the block, because evading the refusal rather than
reporting it would defeat its purpose.

Operator path (already the documented human-triggered route, and explicitly "intentionally NOT
run by any agent session"):

```bash
cd functions && npm run build && cd .. && node scripts/_sandboxDeployGuard.mjs && firebase deploy --only functions --project eos-platform-sandbox --force
```

Prior experience (recorded): large batches transiently fail a subset. Retry, then fall back to
small named batches.

## E2E posture

Not started. The mission's own precondition — "do not run E2E on a knowingly mixed-version
environment" — is not met while Functions are three callables behind. Running it now would
produce failures attributable to the version gap rather than to product defects, which is
exactly the false signal that rule exists to prevent.

Once Functions converge, the CRM Activity surface and Available Equipment are the two areas
whose verdicts depend directly on the missing callables; the rest of the matrix is unblocked.
