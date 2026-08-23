# Warehouse / Parts Lightweight App V1 (WO-04)

**Owner-directed slice, 2026-08-23.** A purpose-built handheld for warehouse and parts work. Not
desktop EOS shrunk to a phone.

---

## 1. What was already there — the trace, before any UI

| workflow | command(s) | capability | list/read callable |
|---|---|---|---|
| supplier receiving | `submitCanonicalReceive` | `inventory.stock.receive` | **`fetchReceivablePurchaseOrders`** |
| put-away | placement record | `inventory.placement.record` + `inventory.location.bin.read` | none |
| pick / stage | WO parts plan | (plan/verify contract) | none |
| transfer | `createTransferOrder` · `dispatchTransferOrder` · `receiveTransferOrder` · `cancelTransferOrder` | `inventory.transfer.*` | none |
| cycle count | `createCycleCount` · `submitCycleCount` · `reconcileCycleCount` | `inventory.cycleCount.create` / `.submit` / `.reconcile` | none |
| return intake | `recordReturnIntake` | `inventory.returns.intake` | none |
| lookup | — (governed Part Master read) | none required | Part Master |

Seven scanning surfaces already existed (`modules/scan/`) and are composed by `ScanWorkspace`. **What
did not exist was any handheld shell at all**, and `ScanWorkspace` is desktop-shaped.

Baseline data access, measured before building: **zero broad listeners** in all seven scan surfaces;
`ScanWorkspace` uses two technician-scoped hooks and nothing else.

## 2. The decisive finding — why Home mostly has no counts

**Only receiving has a governed list callable.** Transfers, cycle counts and returns have commands
and no way to ask "how many are waiting".

So a Home showing "4 transfers waiting" would have required inventing a read — forbidden by this
package — or opening a broad collection query on a phone. Instead:

- receiving may show a **real count**
- every other queue is offered as a way **in**, with no number and the plain statement
  *"Open to see what is waiting — a count is not available on this device yet."*

A missing number is a small disappointment. A wrong number in a warehouse is a stock-out somebody
discovers at a customer site. `COUNTABLE_QUEUES` records this as a fact about the backend, so a
future reader knows the blank is deliberate and knows exactly what would fill it.

## 3. Route and composition

- Nav item `warehouseWorkspace` → `/inventory/warehouse-workspace`.
- **Phone → `WarehouseShell`. Wider → `ScanWorkspace`**, which is the existing desktop entry point
  for these same workflows. Inventing a second desktop surface would be a competitor to the one
  people already use.
- Uses the established `PHONE_QUERY` (639.98px) via the shared `useIsPhone` primitive.
- **Width chooses composition, never authority.** Both branches reach the same governed workflows and
  resolve capability identically on the server.
- `test/warehouseHandheld.test.mjs` guards reachability by reading the **route table**, and was
  verified to fail by actually orphaning the shell. The technician shell was orphaned for two whole
  slices while every component test passed; not again.

## 4. Navigation

`Home | Scan | Work | More` — four, and no more. Every extra tab is a decision somebody makes before
doing any work.

- **Home** — what needs attention, in deterministic domain order.
- **Scan** — one tap from anywhere. Lazy: camera and decoding machinery is not downloaded by somebody
  checking what is waiting.
- **Work** — the same authorized set as a plain list.
- **More** — a closed list (sync seam, scanner help, version, account). No CRM, Sales, Reporting,
  Admin or Finance, asserted.

Choosing a queue on Home **opens that task**, not a menu containing it.

## 5. Attention order — declared, not scored

There is no cross-domain urgency model in this platform, and inventing one would mean a number nobody
agreed on deciding what a warehouse looks at first. So the order is a declared sequence with a stated
reason for each position, which is auditable in a way a score is not:

1. **Receiving** — stock on the dock is not stock the platform knows about; everything downstream is
   working from a lie until it is received.
2. **Put away** — received but not placed. It exists and cannot be found, which for a picker is worse
   than it not existing.
3. **Pick / stage** — a job is waiting on parts. A person is blocked.
4. **Transfers** — stock in motion; the risk is it sitting in neither place.
5. **Cycle counts** — scheduled accuracy work. Important, rarely urgent.
6. **Returns** — arriving goods with no downstream dependency today.
7. **Lookup** — a tool, not a queue. Always last.

## 6. Role composition — absence, not disablement

Composition follows **effective authority**, from `deriveScanWorkflows` — reused, never restated. A
second opinion about who may put stock away is a second thing to keep in step, and it would drift.

A workflow the caller lacks is **not rendered greyed out**. A disabled tile asserts the operation
exists and that access is the only obstacle — untrue for several of these, whose capabilities are
registered `active: false` and carried by no Role anywhere. It would be an invitation to go and ask
for something nobody can grant.

Proven by test: a receiving clerk does not get put-away; put-away needs **both** the placement
authority and the bin read (recording a placement without being able to check the bin is how stock
lands on racking that does not exist); a reconciler is **not** thereby a counter; a throwing
capability gate denies.

The nav gate is `WAREHOUSE_HANDHELD_CAPABILITIES`, the **union** of the station ids the workflows
already use — never a coarse "warehouse user" capability, which is exactly what the station model
exists to avoid. Visibility is convenience; every action is still decided per action, on the server.

## 7. Structured fields

See [EOS Structured Object Presentation Standard](../design/eos-structured-object-presentation-standard.md).

Applied here, and applied to the whole-unit install display, which previously rendered
`Taylor C161 — S/N CW-C161-0001 · AVAILABLE · wh-1` as one line. Locations now resolve through the
governed display projection (`useLocationDisplaySource`); an id that will not resolve renders as
**"Unavailable"**, never as the raw key.

## 8. Performance

| | before WO-04 | after |
|---|---|---|
| entry chunk | 561.24 kB | 578.72 kB (+17.48) |
| entry gzip | 166.88 kB | 171.89 kB (+5.01) |
| `ScanWorkspace` | 74.77 kB lazy | 70.57 kB lazy |

The shell is eager (first screen); the scanning workspace it composes stays lazy. Technician bundle
splitting is untouched.

**No new listeners, queries or subscriptions.** Home derives entirely from the capability gate the
route already resolves, plus counts passed in. There is no Warehouse Home projection because the
measurements did not justify one — and building one would have meant the broad reads §30 forbids.

## 9. Mobile — real browser, 320 / 375 / 390 / 414

Measured with the shipped stylesheet applied:

| width | field layout | overflow | sub-44px | nav |
|---|---|---|---|---|
| 320 | **stacked** | none | none | pinned |
| 375 | 119 / 222 | none | none | pinned |
| 390 | 124 / 232 | none | none | pinned |
| 414 | 133 / 247 | none | none | pinned |

No clipped values, no sideways document scroll, queue cards 83px.

A first measurement pass was invalid — an HMR reload had removed the injected stylesheet, so it was
measuring unstyled markup. Recorded because the numbers looked fine and were meaningless.

## 10. What WO-04 did NOT build

- **No warehouse offline runtime.** The state vocabulary exists; no warehouse command is wired to the
  queue, and More says plainly that warehouse work is sent as you do it. WO-05 wires it.
- No new inventory authority, no new command, no Rules change.
- No site-wide structured-field audit.
- No synthetic Purchase Orders and no live lifecycle scenarios created to populate anything.
