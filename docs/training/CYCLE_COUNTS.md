# Cycle Counts — EOS User Guide

**Audience:** Warehouse / Parts Counter, Technician (assigned truck), Manager / Reconciler
**Applies to:** Inventory → Cycle Counts, and Scan → Count what is on the shelf
**Training represents:** `96f9a66a995942fe3f671feea772e1094e0badc3` (PR #1854, Cycle Counts North Star P1)
**Effective date:** 2026-09-10
**Environment:** deployed — Vercel Production, GitHub Pages
**Owner:** Verenward product training

## What this guide helps you do

Count what is physically on a shelf, in a bin, or on your truck, and get that count in front of the
person who reconciles it — without ever letting the count be nudged toward the number EOS expects.

## Before you start

- **Counting** requires Cycle Count counter authority. Without it, Cycle Counts has no Start/Resume
  option for you.
- **Reviewing/reconciling** requires separate Cycle Count reviewer authority. Counting does not grant
  it, and reviewing does not grant counting — they are deliberately two different capabilities, usually
  held by different people.
- **Technicians:** you also need an assigned truck (below) to count from your MOBILE truck.

## Warehouse / Parts Counter

### Starting a count

1. Go to **Inventory → Cycle Counts**, or **Scan → Count what is on the shelf**.
2. **Continue a count**, if one is already open for your location — resuming shows your prior work,
   not a fresh start.
3. To start a new count, scan the bin or warehouse location you are counting, or choose it from the
   list you're authorized for.
4. The counter workspace opens with a sticky header showing your location and how many lines you've
   counted so far, and a **Scanner ready** line once EOS is listening for scans.

### Counting

- Scan each part. A NONE-tracked part scanned again just increases its counted quantity — you do not
  need to type a number for a repeat scan.
- A serialized part records each serial you scan. Scanning the same serial twice is refused — that is
  EOS catching a duplicate, not a bug.
- You can correct a quantity before submitting, and an honest zero (nothing here) is a valid count.
- You can scan and count as many different parts as you find in this session without leaving the
  screen or losing your place.

### Submitting a line

- Press **Submit** on a line when you're done with that part.
- **Before you submit, the expected quantity is hidden — on purpose.** EOS will not show you what it
  expects until after your count for that line is locked in. This is what makes the count trustworthy:
  nobody, including you, can quietly adjust a count toward the "right" answer.
- Once you submit a line, that line's expected quantity and variance appear. Every other line you
  haven't submitted yet still shows nothing.
- A line that fails to submit (a real technical problem) keeps its reason and stays visible — the
  other lines you've already submitted are not affected. "Try again" appears only for that kind of
  failure, never as a way to reopen a decision.

### Leaving and coming back

- You can leave the screen mid-count. Reopen the same sheet from **Continue a count** and it resumes
  exactly where you left off, with everything you already submitted still shown as submitted.
- If you're offline when you submit, the line shows **Waiting to sync** — this is not the same as
  submitted. It sends itself once you're back online, and only once.

### Finishing

- **Finish Counting** becomes available once every line you opened has been submitted or explicitly
  marked none-here. It is not a stock adjustment — it just marks your counting session done. Nothing
  in inventory changes until a manager reconciles the sheet.

## Technician — counting from your truck

- You need Cycle Count counter authority, same as anyone else — being assigned a truck does not by
  itself let you count.
- If you have counter authority, **Scan → Count what is on the shelf** offers **Count a whole warehouse
  or truck**. For a technician, EOS resolves your one assigned truck itself — you do not choose from a
  list of every truck in the company.
- If you have no active truck assigned, EOS tells you plainly: **"No active truck is assigned to
  you."** There is no Start button in that state — ask your dispatcher to correct the assignment,
  don't work around it.
- If more than one truck is somehow assigned to you at once, EOS refuses to guess and shows a visible
  error instead of silently picking one. Treat that as a data problem to report, not something to push
  past.
- Once your truck is correctly resolved, counting works exactly as described above under Warehouse /
  Parts Counter.

## Manager / Reconciler

### Reviewing a sheet

1. Go to **Inventory → Cycle Counts** and open a sheet.
2. **Lines that need your decision come first** — the sheet groups unreviewed variances ahead of
   matching or already-reviewed lines, so you see what actually needs attention without scrolling past
   everything else.
3. For each line, EOS shows the counted quantity next to the expected quantity, and the variance
   between them.

### Approving or rejecting

- **Approve this line** if the count is correct — this is the only action that adjusts on-hand
  quantity, and it adjusts only that one line.
- **Reject this line** if the count is wrong (miscount, wrong bin, wrong part) — rejecting makes **no**
  adjustment at all. It records the decision and moves on.
- Every decision needs a stated reason. Type it or dictate it.
- **There is no whole-sheet approval.** Each line is its own decision, on its own evidence.
- A serialized line can come back missing a serial you'd expect, or with one you didn't — EOS shows
  that discrepancy plainly rather than only showing a quantity mismatch.

### Separation of duties

- If the same person submitted the count and is now trying to approve a material variance on it, EOS
  refuses and tells you why — you'll see the line's Approve control disabled with a note that it needs
  another reviewer, before you even try. This is not a bug or a permissions gap; it is deliberate.

### Closing the sheet

- **Close Count** becomes available only once every line has a decision. A sheet with any line still
  waiting on review or on a technical retry cannot be closed.

## Truth and safety — what to expect from EOS here

- **Counting is not the same as adjusting stock.** Recording what you saw changes nothing by itself.
  Only a manager's Approve on a specific line adjusts on-hand quantity, and only for that line.
- **Blind counting is the whole point.** The expected quantity is withheld from the counter until
  their own line is submitted — a counted line's own truth never leaks into a sibling line that hasn't
  been submitted yet.
- **A decision, once made where EOS says it's final, is final.** There is no reopen or recount
  workflow — if a sheet needs correcting after review, that is a new count, not an edit to the old one.
- **Zero is a real answer.** "Nothing here" is a valid, expected count outcome, not an error.
- **Offline "pending" is not "submitted."** If you see "Waiting to sync," EOS has not recorded your
  count yet — don't assume it went through until it says so.

## Mobile and scanning

- Works with a hardware keyboard-wedge or Bluetooth barcode scanner, the device camera, or manual
  typed entry — whichever you have.
- The screen tells you plainly when **Scanner ready** — that's your cue the field is listening.
- After each scan or submit, the scan field gets focus back automatically, so you can keep scanning
  without tapping back into the field yourself.
- Counting is supported on phone screens as narrow as 320px wide, and confirmed clean through 414px —
  the layout does not require horizontal scrolling to reach any control, including Approve/Reject on
  the manager review screen.

## Warnings and exceptions

- **"No active truck is assigned to you."** A technician-specific state — see above. Not something to
  work around; report it.
- **"More than one truck is assigned to you."** EOS will not guess — this needs correcting in the
  Truck Registry, not at the counting screen.
- **A refused duplicate serial scan** is EOS protecting count integrity, not a scanner malfunction.
- **"Try again"** appears only for a genuine technical failure on one line — it never reopens a
  decision that already went through.

## If something looks wrong

Check that you have the right authority for what you're trying to do (counting vs. reviewing are
separate), and that a technician's truck assignment is correct in the Truck Registry if the MOBILE
flow isn't showing your truck. If a count or a review decision will not go through and it isn't one of
the states described above, contact your Taylor EOS Administrator — do not work around a refusal by
picking a different location or approving a line you didn't actually review.

## Changes in this release

- **Fixed:** starting or resuming a count could, in rare cases, silently fail to show the active
  session even though it had started successfully server-side — you would appear stuck on the start
  screen. This is fixed; starting or resuming now reliably reaches the active counting screen.
- **New:** technicians with counting authority can count directly from their assigned truck, with EOS
  resolving the one correct truck automatically — no picking from a list of every truck.
- **Confirmed, not new:** counting from a phone already worked at 320–414px widths; this release
  verified it live rather than changing it.
- **Unchanged:** the warehouse/bin manual Start/Resume flow, blind counting, per-line submit, manager
  review and reconciliation, and offline queuing.

## Verification receipt

- Training checked against deployed release/SHA: `96f9a66a995942fe3f671feea772e1094e0badc3`, confirmed
  live on Vercel Production and GitHub Pages (see `docs/releases/bin-sandbox-release-2026-09-10.md`
  §6).
- Workflow exercised/visually verified: real-browser acceptance in PR #1854 — desktop full lifecycle
  (create → active → scan → submit → one-line reveal → sibling-blind → leave/resume), phone at
  320/375/390/414 reaching the active counting screen, technician MOBILE positive and three negative
  cases (no truck / no counter authority / ambiguous assignment), manager review at 390px
  (Approve/Reject reachable without horizontal scroll, separation-of-duties disabled state, next-
  unresolved-variance positioning), and a blind-DOM check confirming no expected/variance value is
  present anywhere pre-submit. Reconfirmed against the deployed Vercel Production build in this
  session: Cycle Counts landing and the mobile counter workspace both render correctly at 375px on the
  live deployment; the deployed environment's backend callables are not currently reachable from this
  origin (an environment characteristic affecting every Cycle Count and Transfer callable alike, not a
  defect in this release — see the release record §6), so live authenticated counting/review was not
  re-exercised against the deployed backend; the PR's real-browser acceptance remains the behavioral
  evidence for that.
- Screenshots current where used: not applicable — none used.
- Known sandbox-only or future behavior present in guide: NO.
- Training status: `COMPLETE`.
