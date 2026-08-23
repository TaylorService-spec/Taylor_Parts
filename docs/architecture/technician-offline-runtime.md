# Technician Offline Runtime (WO-03 / WO-03A)

**Owner-directed slices, 2026-08-23.** Durable local work → queued intents → governed sync → conflict
recovery, and the reachable handheld app it sits under.

**UI-integrated today — all five:** Notes · Labor · Parts Used · Equipment Install · Work Order
Complete. Each captures into the durable queue from the rendered technician app and is proven
end-to-end in `test/technicianOfflineEndToEnd.test.jsx`, which drives the shell and asserts on what
the service layer was asked to do rather than on any queue API.

The earlier caveat that only Notes and Time were wired no longer applies.

---

## 1. The principle

Offline work is **local intent**, never authoritative business state.

A phone may say `Pending sync`. It may not say `Installed`, `Completed` or `Saved` because somebody
tapped a button with no signal. Every state except `SYNCED` carries `claimsComplete: false`, and the
copy is asserted against that — `test/offlineSyncUi.test.jsx` renders a queued note and fails if the
word "saved" appears.

## 2. Storage

| | |
|---|---|
| engine | IndexedDB, falling back to localStorage, falling back to memory |
| key | `eos.tech.offline/{principalUid}` |
| schema | version 1, with a real forward-only migration registry |
| encryption | **none — see §9** |

The engine is a three-method adapter (`get`/`set`/`remove`) and is deliberately the smallest part of
the module. Every interesting failure — a queue restored under the wrong user, a schema a newer build
wrote, a save that silently did not happen — is decided above it and is provable against an in-memory
adapter, because they are the same bugs whichever engine is underneath.

`selectAdapter` probes rather than assumes: Safari's private mode exposes `localStorage` and throws on
write, so it is written to once and discarded if it refuses.

**Memory is a real outcome, not an unhandled case.** A device with nowhere durable to write reports
`durable: false`, and the UI says *"This phone is not saving work offline"* rather than
`Pending sync` — see §7.

## 3. What is cached

A closed list (`CACHE_KIND`), because the cheap mistake is caching "whatever the screen needed" and
ending up with a copy of the CRM on a phone:

`WORK_ORDER` · `WORK_ORDER_CONTEXT` · `PARTS_READINESS` · `INSTALLABLE_EQUIPMENT` · `LABOR_SUMMARY`

Every cached record carries `kind`, `serverId`, `fetchedAt`, `serverVersion`, `source` and
`principalUid`. **`serverVersion: null` is a legitimate answer** — several of these projections expose
no version field, and inventing one would be worse than admitting we cannot tell whether the server
has moved. `fetchedAt` is what lets a screen say "as of 09:15" instead of implying it is current.

## 4. The intent envelope

Five types, and only five: `NOTE_ADD` · `LABOR_RECORD` · `PARTS_USAGE` · `EQUIPMENT_INSTALL` ·
`WORK_ORDER_COMPLETE`. **Not a generic command queue** — a generic queue would let any future caller
put an arbitrary callable into durable storage on a phone, to be replayed hours later under authority
nobody checked at capture time.

`intentId = hash(type | workOrderId | captureKey)`. Derived, never random: a phone that retries, a tab
that reloads and a queue restored after a crash all produce the same id, and that id travels as the
server's idempotency key. Random ids would make every retry a new business effect — for labor, double
hours; for install, a second Equipment record.

`payloadFingerprint` is key-sorted, so a refactor that reorders a payload is not read as a changed
request. Same id + same fingerprint is a **replay** and is safe. Same id + different fingerprint is a
**conflict** and goes to a person.

## 5. Dependencies — two kinds, and why

| edge | meaning | blocks |
|---|---|---|
| `required: true` | a **requirement** | until the dependency SUCCEEDS, and permanently if it fails |
| `required: false` | a **sequencing** edge | only while the dependency is still LIVE |

The one required edge in V1 is `EQUIPMENT_INSTALL → WORK_ORDER_COMPLETE`. A completed installation job
whose installation never happened is a lie about a machine at a customer site, and this makes it
unreachable rather than unlikely.

Notes, labor and parts are **optional** — a technician who wrote no note has still finished the job,
and requiring one would invent a business rule nobody asked for.

**But optional is not ignored, and this is a deliberate deviation worth stating.**
`recordWorkOrderLabor` and `updateWorkOrderExecutionData` are both refused once a Work Order leaves
execution. Sending Complete while labor is queued does not merely reorder two requests — it makes the
labor request *permanently impossible*, and a technician's hours end up needing a manager's
correction. So an optional dependency holds its dependent **while it can still land**, and stops the
moment it needs a person. Completion waits for work that might still succeed; it does not wait forever
for work that has already stopped.

## 6. Ordering

Dependency depth → type precedence → capture time → intent id.

Nothing depends on array insertion order, component render order, or hook firing order, so a future
refactor that changes when a component mounts cannot reorder business effects. The final tie-break on
id makes the order **total**, and therefore reproducible: two intents captured in the same millisecond
never swap places between runs.

## 7. The sync sequence

1. confirm a session exists
2. confirm the session's uid **is the queue's owner** — a different user never sends this queue
3. refresh authority (advisory; see below)
4. re-read authoritative state (precheck)
5. evaluate dependencies against the live queue, not the snapshot the batch came from
6. submit the canonical command
7. reconcile the exact server result into `resultingServerIds`
8. persist

**Offline permission is not permission.** An intent captured at 09:00 is authorized when it is SENT.
That recheck is *not* performed client-side and could not honestly be: every command resolves the
caller's capability on the server, inside its own transaction, against current `roleAssignments` —
`recordWorkOrderLabor` reads authority *through* the transaction precisely so a revocation mid-flight
conflicts the commit. A client-side check would be a second, weaker, staler opinion whose only
contribution is false confidence. What this runtime guarantees is that the server always **gets the
chance to say no**: no stored authorization is replayed, no allow is cached, and every refusal is
believed.

`refreshAuthority` is an injected optimisation that can spare a doomed request. It decides nothing.

## 8. Failure classification

| class | example | result |
|---|---|---|
| `RETRYABLE` | offline, `unavailable`, `internal` | bounded backoff, max 8 attempts |
| `CONFLICT` | `ASSET_INSTALLED_ELSEWHERE`, `NOT_ASSIGNED_TECHNICIAN` | stops, needs a person |
| `REFUSED` | `permission-denied`, `invalid-argument` | stops, **never retried** |
| `NEEDS_ATTENTION` | `IDEMPOTENCY_CONFLICT` | stops, a person must choose |

`TERMINAL_ERROR_CODES` is **imported** from `domain/offlineSubmissionQueue.js`, not copied, so the
warehouse queue and this runtime cannot drift into disagreeing about what a refusal is.

Anything unrecognized is retryable — retrying a transient failure costs one request, giving up on one
loses a technician's work. Backoff is exponential, capped at five minutes. Exhaustion becomes
`NEEDS_ATTENTION`, **not** `REFUSED`: the server never refused it, we stopped asking, and saying "not
accepted" would put words in the platform's mouth.

**Offline is never a refusal.** Nobody said no; it never reached anyone to be refused by.

## 9. Security of local data

**Browser storage is not application-encrypted, and this runtime does not pretend it is.** Cached work
orders, customer names and site addresses sit on the device protected by the device's lock screen and
by nothing this code does.

Credentials never enter it. `containsForbiddenMaterial` refuses any payload carrying a key matching
`token` / `authorization` / `password` / `apikey` / `secret` / `credential` / `bearer`, at capture,
because a convention is not a control and the failure mode is a refresh token in IndexedDB on a lost
phone.

Diagnostics carry ids, states, attempt counts and error codes — **never payloads**. Asserted: a
diagnostic dump of an intent containing a customer name, a street and a serial contains none of them.

## 10. Account isolation

The store is keyed by uid **and** the record carries the uid. Both, on purpose: the key prevents two
accounts sharing a queue, the stored uid catches the case where they somehow do. A foreign record is
refused — not migrated, not merged, not adopted — and **not deleted**, because it belongs to whoever
queued it and they may sign back in on this device.

Signing out does not delete queued work. The executor independently refuses to send a queue whose
owner is not the current session, so both halves are enforced rather than assumed.

## 11. Schema migration

Forward only, bounded, and refusing rather than guessing:

- a record from a **newer** build is left alone, never downgraded — this build cannot know what a
  future field means, and dropping it to fit would silently destroy it
- a **missing** migration is `CORRUPT`, not a silent empty queue
- a migration that fails to advance the version is bounded at 50 steps, so a bad migration is a
  visible refusal rather than an infinite loop on a technician's phone at the moment they open the app

There has been no schema change yet, and inventing a historical one would be fiction. What matters
before a second version exists is that the mechanism works, so it is exercised with an injected
1→2 migration that must preserve pending intents.

## 12. Connectivity

`navigator.onLine` answers "does this device have an interface that thinks it is attached". It says
nothing about whether our server is reachable, and it is famously true on captive-portal wifi — hotel
networks, plant-floor guest networks, half the sites a technician visits.

So it is a **hint**, trusted only in the negative direction, and used for two things: whether to bother
attempting, and what to say on screen. The authoritative answer to "can we reach the platform" is
always a real request that either landed or did not.

There is **no polling loop**. A pass runs when work is queued, when the browser reports the network
returning, or when a person presses Sync now.

## 13. Scanning offline

`KNOWN_FROM_CACHE` · `NEEDS_ONLINE_RESOLUTION` · `INVALID_FORMAT` · `SERVER_NOT_FOUND`

**`NEEDS_ONLINE_RESOLUTION` is not `NOT_FOUND`.** A technician told "not found" puts the box down and
looks for another one; telling them that because a lookup could not run is how the wrong machine gets
installed. `INVALID_FORMAT` is the only verdict a device may reach alone, and it reuses
`normalizeScanToken` — the existing shared authority on what a scanned string is — rather than a second
regex that would drift from it.

An install intent may carry a raw serial. It is **not an asset, it is a claim about one**, and the
command refuses to act on an unresolved one (`ASSET_NOT_RESOLVED`).

## 14. Install conflicts

Resolution happens in the precheck, against `getInstallableEquipmentForWorkOrder` — which verifies the
Work Order is assigned to this technician, derives customer and location from the Work Order, and
returns only installable units. "Is it in this list" therefore answers assignment, installability and
existence in one authoritative read.

**Nothing is substituted, ever.** A scan matching zero units conflicts; a scan matching more than one
is `SCAN_AMBIGUOUS` and asks for the full serial. An available unit that happens to be on the list is
not the unit the technician had in their hands, and quietly installing it would put the wrong serial at
a customer site.

## 15. Completion

`transitionWorkOrder` is action-based and **not idempotent**, so a lost response must never become a
second Complete. The precheck re-reads the Work Order: already `COMPLETED`/`CLOSED` reconciles as
`SYNCED` (the intended result already holds); assigned to somebody else conflicts.

## 16. Two clocks

`deviceReportedAtMillis` is present **only when the capture was genuinely offline**. An online capture
is submitted immediately and the server's clock is the only one that matters, so it claims nothing.
Offline labor is captured as `DURATION`, never a fabricated `INTERVAL` — Labor V1 supports both shapes
precisely so this does not have to invent a start time.

## 17. Conflict UX

Every refusal answers four questions in the technician's terms: what was attempted, what happened *in
the world*, what is preserved, what to do next. Raw codes are never the headline; they are one tap
away under Details, for a support conversation.

**Every card says the work is preserved.** That is not padding — the first fear at that moment is that
the work is gone, and it never is. Saying so every time is the difference between a technician who
reports a problem and one who quietly re-does the work by hand.

## 17a. Reachability and composition (WO-03A)

The shell this runtime sits under was, for two slices, **imported by nothing**. Every component test
passed because rendering a component is importing it, and no technician could open it.

- Route: the `technicianWorkspace` nav item (`/technician-workspace`), previously falling through to
  a legacy key that rendered FieldMode at every width.
- **Phone → `TechnicianShell`. Anything wider → the existing desktop composition.** The breakpoint is
  the established `PHONE_QUERY` (`max-width: 639.98px`), reused rather than reinvented.
- **Width chooses composition, never authority.** Both branches render the same governed surfaces,
  resolve capability identically on the server, and read the same technician-scoped Work Orders.
  Rotating a device changes nothing about what a person may do — asserted.
- `test/technicianShellReachability.test.mjs` reads the **route table**, not any test file, and fails
  if the shell is orphaned, imported-but-unrendered, or reachable only from something that does not
  ship. It was verified to fail by actually orphaning it.

**One runtime, provided from the top.** The shell renders FieldMode, and both wanted the offline
runtime. Two runtimes over one storage key means two writers, and the loser's captured work
disappears with no error at all. `OfflineRuntimeContext` provides it once; `useOfflineRuntime({
disabled })` keeps the hook call unconditional without opening a second queue.

## 17b. Two races integration exposed

Both shipped in WO-03 and neither runtime test could see them, because every runtime proof enqueued
through separate awaited actions.

1. **Two captures in one tick lost the first.** Every mutator read the queue from its closure, so the
   second persisted a queue built without the first. Capturing an installation and its dependent
   completion does exactly this — the installation vanished behind a "pending sync" that was untrue.
   Fixed with a live ref; regression-tested.
2. **A capture made before storage finished loading was wiped.** The initial read is asynchronous and
   assigned its result over the top. Open the app, tap straight into a note, and it disappeared. The
   load now **merges**, and anything already in hand wins.

Also changed: a person pressing **Sync now** clears the backoff. Backoff exists to stop a phone
hammering a dead link automatically; a technician deliberately pressing the button is new
information, and making them wait out an invisible five-minute doubling is the app knowing better
than the person holding it. Automatic passes still respect it.

## 18. What was NOT built

- Warehouse offline (§38) — the primitives are generic; the semantics here are Technician commands.
  WO-05 applies the architecture to inventory.
- A background sync worker or service worker.
- A technician-facing labor **correction** UI (the authority exists; nobody holds it).
- Offline dictation — see §19.

## 19. Dictation, resolved

**Classification: `PLATFORM_DEPENDENT`, in practice `ONLINE_REQUIRED`.**

The implementation is the Web Speech API. Chrome, Chrome for Android and Safari all reach a remote
speech service; some recent browsers can install an on-device model, and nothing in the standard API
lets a page know that before trying.

So the classification is **observed, not asserted**: a recogniser that cannot reach its service fires
`error: "network"`, which is the one authoritative signal available, and `navigator.onLine === false`
is a pre-emptive hint so a technician with no signal is told *before* holding a phone to their mouth.

The copy is truthful about which half is unavailable — *"Dictation needs a connection. Type the note
instead — typed notes save offline."* **Typed notes remain fully offline-capable**, which is why the
textarea is never disabled by any of this.

The provider was **not** changed to produce a nicer answer. An on-device recogniser is a real product
decision with a real cost, not a side effect of resolving a classification.

## 20. Performance

| | baseline | after | delta |
|---|---|---|---|
| entry chunk (WO-03) | 633.69 kB | 663.57 kB | +29.88 kB |
| entry chunk (after WO-03A) | 663.57 kB | **561.24 kB** | **−102.33 kB** |
| entry gzip (after WO-03A) | 192.41 kB | **166.88 kB** | **−25.53 kB** |
| `SyncQueue` chunk | — | 3.70 kB (1.28 kB gzip) | lazy |
| `ScanWorkspace` chunk | in entry | 74.77 kB (19.67 kB gzip) | now lazy |

WO-03A mounting the shell **reduced** the entry chunk below both prior baselines. `ScanWorkspace` was
the one eager route-level import among its lazy neighbours in `App.jsx`, which put the whole scanning
workspace in the entry for every user who never scans — and made the shell's own lazy boundary around
it do nothing.

Measured on the production build actually served: **367.4 kB gzipped total at startup**, with **zero
desktop chunks and zero scan chunks fetched**. Barcode decoding uses the browser's native
`BarcodeDetector`, so no decoder is bundled at all.

The queue **panel** is lazy; the **indicator** is eager and deliberately so — the one state that must
never exist is unsynced work with nothing on screen saying so, and a chunk that has not downloaded
cannot say anything.

**The send machinery is also eager, deliberately.** Lazy-loading the executor would save perhaps 3 kB
gzip and make an offline runtime's sync engine something that has to be downloaded. That is the kind of
clever that fails in a plant room, and the trade was refused rather than missed.
