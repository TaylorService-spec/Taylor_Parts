# F2 Scanner — Technician Persona Missions, Rounds 1–3

**Status:** evidence preserved · F2 branch not yet merged
**Method:** one technician business mission per round, blind (no defect list, no mention of what changed), each against ONE pinned deployed build with D2 verified beforehand.

| Round | Build | FUNCTIONAL | EXPERIENCE |
|---|---|---|---|
| 1 | `5429b0f` | PASS (barely) | FAIL |
| 2 | `22284e4` | PASS (one hard gap) | FAIL |
| 3 | `46af8bb` | **PASS** | FAIL |

Functional quality converged. Experience did not, and the reasons changed each round — which is the pattern working: each fix exposed the next layer.

---

## 1. Fixed and independently verified

Each was found by a mission and confirmed resolved by a later mission that was never told about it.

| Defect (round found) | Verified in |
|---|---|
| Part number universes disconnected — technician's `PRT-1001` invisible to a scanner that only knew demo `CMP-048-230` | R1 → resolved via governed identity, not aliasing |
| Result card echoed the typed code; no job named | R2 → card names the job (`for WO-2026-SBX004`) |
| One message covered three different failures | R2/R3 → distinct messages; the malformed-code message was called "the best message in the app" |
| Quantity silently assumed 1 | R3 → stepper works, floor clamps at 1 |
| No guard on over-plan recording | R3 → `The plan says 1. Record 5?` — "asks exactly the right question", cancel preserves state |
| Success and failure identical grey pills | R3 → success is green with ✓ and a left rule |
| Scanner could close the **wrong job** (a second full-strength "Complete job" on a scanned WO) | R3 → gone; no such control exists |
| "View part details" printed *"Open this from your job to continue"* while on the job | R3 → gone |
| Touch targets below 44px (toggle 41, Logout 61×24) | R3 → all measured targets clear 44px |
| Progress rail marked "Complete" current on a WORK_IN_PROGRESS job | R3 → correct state highlighted |

---

## 2. Open — scanner scope, fixable without a new decision

1. **Errors are styled weaker than success.** Success shouts (green, icon, border); every failure is plain grey body text indistinguishable from helper text. Backwards. Neither is wrapped in `role="status"`/`role="alert"`, so nothing is announced.
2. **Error copy still implies existence in two cases.** `PRT-9999` (not real) and `PRT-1002` (real, other job) return the identical *"That code isn't on any of your current jobs."* — the technician cannot tell a bad barcode from a wrong-job part. Empty submit says *"That code couldn't be read"*, blaming a camera that was never used.
3. **`−` at quantity 1 is a live button that does nothing** — should read as a floor.
4. **Camera-denied message renders below the fold**, so tapping "Scan a code" appears to do nothing.
5. **Scanner placement.** Collapsed, at the very bottom, below the *next* jobs list — roughly 1,900px from the job it acts on. Repeatedly flagged across all three rounds.

## 3. Open — needs a decision or another programme

| Finding | Why it is not a scanner fix | Owner |
|---|---|---|
| **Part identity is a bare SKU.** The card shows `PRT-1004` and nothing else — no name, description or image — so a technician holding a physical part still cannot confirm it is the right one. `snapshotPartName` already falls back to the SKU because the snapshot carries no name. | Needs either richer planned-part data or a governed Part Master read a technician does not currently hold. **This is the single highest-value gap and it recurred in all three rounds.** | Materials / #226 |
| **No running total; silent duplicate recording.** After recording 1 then 5, the card still reads `Plan: 1`, quantity resets, and the job card still shows `UNKNOWN`. A technician unsure whether a tap registered will tap again, and the app rewards that with duplication. | Requires surfacing `qtyUsed` and the readiness projection on the job card | Readiness / Materials |
| **No undo or correction** of a recorded consumption, before or after completion. | No governed reversal path exists; a UI affordance over a callable that cannot reverse would be worse than the gap | Material decision |
| **Off-plan / substitute parts hard-blocked.** `updateWorkOrderExecutionData` rejects an unplanned sku server-side. Technicians substitute constantly. | Allowing it is a material authority decision about what a technician may record | Material decision |
| **`Complete job` is unguarded, unacknowledged and irreversible** — one tap, no dialog, no confirmation, and it completed a job whose parts readiness was "can't be confirmed" with 6× the planned quantity recorded. It has *less* friction than recording a part. | F1 surface, not the scanner — but it is the most dangerous control in the technician app | F1 / Field |
| **Scanner is bound to one implicit job**, yet the input invites work-order codes and then answers *"Nothing to do with this here."* A technician on a two-job site could book parts to the wrong work order. | Whether a scan may retarget the recording job is a workflow decision | Field / UX |
| **Stage chips are decorative** — Travelling / On site cannot be set, so four of five states are unreachable from this screen. | F1 lifecycle surface | F1 / Field |
| **Dashboard leaks raw identifiers** (`acct-harbor`, `WORK_IN_PROGRESS`) and a meaningless `Avg. Job Duration 1m`, and is the technician's landing route. | IA / landing decision | UX / IA |

---

## 4. What F2 closes of Finding A — and what it does not

Recorded explicitly so the seam is not overclaimed.

**F2 CLOSES:** physical scanned token → governed canonical identity → readable candidate context → authority-derived action → governed command. Identity resolution is exact, scoped to what the caller may read, and returns four distinct failure states. Actions are derived from what the server enforces rather than listed, and there is exactly one.

**F2 DOES NOT CLOSE:** warehouse availability · truck availability · shortage orchestration · fulfilment · job parts readiness · substitution. The technician still cannot answer *"do I have the parts to finish this job?"* — three rounds confirmed the job card reports `Parts readiness unknown` throughout, and every parts panel remains captioned "Visual only — no inventory engine connected yet."

**Finding A is therefore NOT complete.** F2 closes the identity half of the seam. The availability and fulfilment half belongs to a later Materials / Service programme.

---

## 5. Method notes

- All three rounds used a pinned build with D2 verified before execution, and none was told what had changed — the fixes were confirmed by missions that had no knowledge of them.
- Credentials were read from file at runtime; no round hardcoded or echoed a password (the failure mode seen in the Gate 2 rounds).
- Round 3's reviewer completed a job with 6× the planned quantity recorded and no confirmation. That was a real, reproducible finding — the sandbox data now reflects it.
