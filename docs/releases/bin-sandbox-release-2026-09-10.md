---
artifact_type: release
gate: BIN release to eos-platform-sandbox (Owner ruling B2, Decision #178) — sandbox only
status: NOT DEPLOYED — operator action required (agent sessions are hard-denied deploy by .claude/settings.json)
date: 2026-09-10
target: eos-platform-sandbox — never taylor-parts
---

# BIN release to sandbox — operator record

## 1. What the release carries

Deploy the **current tip of `origin/main`** (at writing: `5593fae`, which contains everything below). Do not
pin an older SHA: the provenance guard requires the tip, and `/version.json` is the evidence afterwards.

| PR | Content | Surface |
|---|---|---|
| #1833 | BIN-P6 specification | docs |
| #1835 | `relocateStock`, one on-hand authority, Transfer BIN endpoints | Functions |
| #1836 | Scan → Move stock multi-scan | Hosting |
| #1837 | Conversion reconciliation + runbook | scripts/docs |
| #1838 | BIN-P4: `inventory.stock.relocate` active in platform-sandbox; two functional Roles | Functions + Hosting (environment snapshot and the frontend eligible list) |
| #1840 | BIN-P7: Cycle Count admits BIN behind the conversion gate | Functions |
| #1841 | A1 reconciliation | docs |
| earlier | P2R/P3/P5 — already live at `5ddb9e4a` or included by the tip | — |

**Live sandbox before this release:** `5ddb9e4a` (buildTime 2026-09-07T16:51:52Z).

**Rules and indexes: no change** since `5ddb9e4a` — `git diff 5ddb9e4a origin/main -- firestore.rules field-ops-app-vite/firestore.rules firestore.indexes.json` is empty. The release is **Functions + Hosting only**; no Rules deploy is needed or authorized by this record.

**Release order.** The governed script's own order (functions build/deploy, then the environment build and
Hosting). It is correct here: the new client offers Move stock only to a holder of `inventory.stock.relocate`,
which the deployed Functions' environment snapshot activates; Hosting first would briefly show Move stock to
nobody (the capability would still resolve inactive) — safe either way, but Functions first avoids a window
where the screen is offered and the callable does not exist yet.

## 2. Operator commands

The release checkout `D:\Taylor_Parts-eos` was on another session's branch (`chore/verenward-workspace-identity`,
clean) at writing. Moving it is that session's call; coordinate first (see *Active change ownership*).

```powershell
cd D:\Taylor_Parts-eos
git fetch origin
git switch main
git merge --ff-only origin/main
.\sandbox-refresh.ps1
```

Then verify (read-only):

```bash
curl -s https://eos-platform-sandbox.web.app/version.json
```

`commit` must equal the `origin/main` tip that was deployed.

```bash
npx firebase functions:list --project eos-platform-sandbox --json
```

`relocateStock` must be present, as must `createCycleCount`, `createTransferOrder`, `receiveTransferOrder` and the bin callables.

## 3. Grants for the gate personas (governed grantRole path, operator-applied)

| Persona | Add | Why |
|---|---|---|
| `partsAssociate` | `inventoryStockRelocationOperator` | already holds `inventoryPutAwayOperator` → the "holds both" put-away persona |
| `technician` | `inventoryTransferReceiver` | receive-only truck handoff |
| `partsManager` | nothing | stays put-away-only → the "put-away alone is refused" persona |
| `warehouseManager` | nothing | `inventoryTransferOperator` → custody-boundary persona |

Use `functions/scripts/operatorAccessCommand.js` (`grantRole`) with a named recipient, a stated need and an
operator-supplied idempotency key, exactly as `scanner-sandbox-validation-2026-08-21.md` §1 did.

## 4. Quick Gate

```bash
node scripts/runSandboxBinMoveScenarios.mjs
```

Covers the Owner's gate items 1–3, 6–8 and 10–17 at the API as real personas, and asserts the Warehouse
aggregate is conserved end to end. Items 4, 5, 9 (session batching, repeated-scan aggregation, retry of only
technical failures) are screen behaviour — proved in `moveStockScan.test.jsx` and checked in the handheld pass.
Item 18 (Receiving unchanged): re-run scenario 5 of `scripts/runSandboxScannerScenarios.mjs`. *Note:* that
runner's bin setup still passes a `code` to `createBin`, which BIN-P1 now refuses (`code_not_accepted`);
scenario 5 does not depend on bins.

## 5. Handheld pass (320 / 375 / 390 / 414)

Signed in as `partsAssociate`, Scan → Move stock, at each width:

- [ ] warehouse picker, From and To pickers and the item scan field fit without horizontal scroll;
- [ ] scan a bin label (`EOS-LOC:` token) into To; scan the same part three times → one line, quantity 3;
- [ ] a second part → a second line; a serialized part prompts for the serial and refuses a duplicate;
- [ ] Confirm → per-line results; a refused line stays visible with its reason; "Try again" appears only for technical failures;
- [ ] as `partsManager`, Move stock is not offered; as `technician` + receiver, Transfer receive is offered and Move stock is not.

## 6. Recorded, not changed

- **Client-direct reads.** Move stock reads `parts` (Rules: admin/dispatcher or PARTS_MANAGER / WAREHOUSE_MANAGER
  operational role) and `warehouses` (admin/dispatcher or assigned warehouse manager) directly, like Lookup and
  Transfer already do. A **Parts Associate** holding the new Role may therefore be refused the catalogue read and see
  "You are not authorized to look up parts". The sandbox `partsAssociate` persona will show whether that applies.
  If it does, the fix is a governed server read or a Rules change — both are Owner decisions (Rules = Tier 2), not
  release defects.
- **Technician receive.** `receiveTransferOrder` is authorized by the new Role, but the Transfer screen lists orders
  from a client `transfer_orders` read that Rules limit to admin/dispatcher/assigned warehouse managers. The API
  receive works; whether a technician can *see* the order on the handheld is the same class of question.

## 7. Result

*To be filled in after the operator deploy:* deployed SHA, `functions:list` evidence, gate output, handheld notes.
