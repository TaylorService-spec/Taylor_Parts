# Cycle-count submit accepts unrecognised fields; its siblings refuse them

**Status:** open · product inconsistency · no authority impact
**Found:** Pass 3B blind-count proof, 2026-08-22
**Scope:** `functions/src/cycleCount/cycleCountValidation.ts` → `validateSubmitCycleCountInput`

## What happens

A submit payload carrying a field the command does not define is accepted:

```js
submitCycleCount({ cycleCountId, countedQuantity: 26, expectedQuantity: 99999 })
// -> applied. variance -1, computed from the STORED expected of 27.
```

The supplied `expectedQuantity` is ignored — `submitCycleCount` computes
`variance = countedQuantity - stored.value.expectedQuantity`, and the stored figure was computed
server-side at create by `computeExpectedQuantityThroughTxn`. So the caller cannot widen or narrow
their own variance, and there is **no authority impact**.

## Why it is still worth fixing

Both sibling domains refuse unknown keys explicitly, and say why:

| Command | Guard |
|---|---|
| `validateReceivingBatch` | `ALLOWED_TOP_KEYS` + `ALLOWED_LINE_KEYS` → `unknown_field` |
| `validateTransferOrderInput` | `ALLOWED_INPUT_KEYS` → `unknown_field` |
| `validateSubmitCycleCountInput` | **no allow-list** |

Cycle count rejects only the *cross-mode* field — `countedSerialNumbers` in NONE mode,
`countedQuantity` in SERIAL mode. Anything else passes.

The receiving validator states the principle directly: *"Server-authored and derived fields are
rejected on the way in — a caller cannot declare its own expectedQuantity, status or trackingMode."*
Cycle count holds the same principle in its behaviour and not in its validation, which means it is
true by implementation rather than by contract. A later refactor that read `input.expectedQuantity`
for any reason would find it already being sent by callers who believed it was honoured.

There is a second, quieter cost: a client that sends the field gets a success response and no
signal that it was discarded. Silently ignoring input is how two systems come to disagree about what
was actually requested.

## The fix

Add the allow-list its siblings have:

```ts
const ALLOWED_SUBMIT_KEYS = new Set(["cycleCountId", "countedQuantity", "countedSerialNumbers"]);
if (Object.keys(input).some((k) => !ALLOWED_SUBMIT_KEYS.has(k))) {
  return { valid: false, value: null, reason: "unknown_field" };
}
```

`reconcileCycleCount` and `cancelCycleCount` should be checked for the same gap in the same change.

## Why it was not fixed in Pass 3B

It is a product change in a governed command's validation, outside the certification-fixture scope
this pass was authorized for, and it changes a public request contract — a caller currently sending
an extra field would begin receiving a refusal. That is the correct behaviour and it is still a
behaviour change that belongs in its own reviewed slice rather than inside a dataset pass.

Recorded here, asserted in `runCycleCountScenarios.mjs` as an explicit FINDING check so it cannot be
forgotten, and left for a product slice.

## What the certification world asserts meanwhile

That the property which actually matters holds: a counter-supplied `expectedQuantity` is **ignored**,
the variance is computed from the server's figure, and the count is therefore blind at the boundary
that governs it.
