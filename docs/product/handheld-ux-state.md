# Handheld UX — current state

**Reconciled against `origin/main` on 2026-08-21.** Mobile UX consolidation over the existing
scanner, work-order and inventory authorities. No new domain architecture, no new capability, no new
collection.

---

## 1. Current core UX — what shipped

### Technician handheld

| Piece | State |
| --- | --- |
| Technician Home (current job, up next, next action) | Existing `FieldMode`, unchanged |
| Work Order above-the-fold (where / what equipment / what problem / what next) | Existing `CurrentJob` rhythm: Context → State → Attention → Readiness → Next Action |
| **Contextual scan** | **New** — the scanner inherits the job it was opened from |
| **Notes, typed or spoken** | **New** — `JobNote` over the existing `executionNote` field |

**The defect this closed.** `PartsScanner` resolved its target as `active[0]` — the *first* active
work order, whichever that happened to be. A technician with three jobs who opened the scanner from
inside job two had the part recorded against **job one**, silently, with a confirmation naming the
wrong job. Nothing refused it: the server was told a work order they genuinely are assigned to, so
every authorization check passed. The only thing wrong was which job got the part.

Opened from a Work Order the caller now passes `workOrderId`. A supplied id is still matched against
the technician's own assigned work, so the prop widens nothing.

### Warehouse / parts handheld

Eight workflows, each offered only to a persona that can actually perform it:

Lookup · Receive · Put away · Pick / stage · Transfer · Cycle count · **Return intake** · Technician
work-order scan

**Return intake was deployed and unreachable.** `recordReturnIntake` had been deployed, activated in
the sandbox and granted to the warehouse manager since the promotion, with no way to reach it. It now
has a surface — built on the existing governed command, with no disposition control of any kind.

### Voice dictation — current behaviour

**Voice is an input method, not an authority.** It appears in three places: technician job notes,
put-away and pick exception notes, and the return-intake reason.

In every one of them the behaviour is identical:

> Type **or** speak → the words land in the same editable draft → the operator reads them → a
> separate deliberate press saves.

**Raw transcription is never auto-saved.** Speech recognition mishears part numbers, model codes and
customer names above all, and these are records somebody may later rely on. There is no path from
microphone to server that does not pass through a human reading the words, and each screen says so.

Dictation reaches no transport, resolves no identity, and decides nothing. It cannot be asked to do
anything.

---

## 2. Future add-ons — NOT part of handheld completion

None of the following is built, and none may be counted toward handheld completeness:

- conversational warehouse assistant
- Siri-like technician assistant
- AI troubleshooting
- AI route optimisation
- automatic replenishment
- camera damage recognition
- autonomous exception classification
- automatic note rewriting or generated service reports

The boundary is enforced rather than promised: `DictatableNote` has tests asserting it cannot name
`intent`, `parseCommand`, `assistant` or `nlp`, and reaches no transport.

---

## 3. Shared primitives — reused, not re-invented

`ScanInput` · `DictatableNote` · `SubmissionQueueStatus` · `OperationalCard` · `Button` ·
`WorkspaceHeader` · the `fo-scan__*` result/notice treatment.

No generic mobile mega-component was created. Domain workflow components stayed domain-specific:
`PutAwayScan`, `PickScan`, `TransferScan`, `CycleCountScan`, `ReturnIntakeScan`, `PartsScanner`,
`JobNote`.

---

## 4. Mobile accessibility — measured, not asserted

Verified in a **real browser** at 375px, and at 320px as a stress width:

- **zero** horizontal overflow at both widths;
- **zero** interactive controls under 44px.

Two were found and fixed in the process, both on the sign-in screen every handheld user passes
through: the password reveal (34px) and the forgot-password link (18px) — the latter reached
precisely when somebody is already locked out.

The static half is held by `scanMobileRegression.test.jsx`: 44px floors, 16px inputs so focusing does
not zoom iOS, single-column-by-default layout, no rule pinning a width past 360px, focus returning
after every scan, Enter submitting for a wedge, rapid scans all registering, and long identifiers
wrapping.

> Its evidence boundary is stated rather than implied: jsdom computes no layout, so sizing is read
> from the real stylesheet as text. The browser measurement above is what covers the rest.

---

## 5. Rollout state, kept separate

| Dimension | Technician | Warehouse / Parts |
| --- | --- | --- |
| Repository complete | Yes | Yes |
| Deployed | Pending next Hosting release | Pending next Hosting release |
| Capability active | n/a (role-based) | Sandbox only |
| Granted | n/a | Four personas |
| Persona user-operable | Lookup, scan, notes | Lookup, put-away, pick, count, transfer, returns |
| **Receiving** | — | **Deployed and active, and NOT user-operable** — no persona holds it |

---

## 6. Known gaps

1. **A technician cannot accept a truck handoff.** Needs `inventory.transfer.receive`; the only role
   carrying it also confers create/dispatch/cancel — too much for a van. A receive-only role is
   required.
2. **No phone-first primary navigation** (Home / Jobs / Scan / More). Both surfaces are reached
   through the existing shell. Contextual entry points were the higher-value half and shipped first.
3. **No `sbx-whassoc` persona**, so Warehouse Associate remains unexercised in the sandbox.
4. **`getPartBalance` redeploy outstanding** — a merged, tested fix not yet deployed.
