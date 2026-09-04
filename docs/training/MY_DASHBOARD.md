# My Dashboard — EOS User Guide

**Audience:** every EOS user  
**Applies to:** My Dashboard (the screen you land on after signing in), and the technician profile screen  
**Training represents:** the release containing Owner Decisions #162, #163 and #172  
**Effective date:** 2026-09-03  
**Environment:** sandbox training  
**Owner:** Verenward product training

> **Status: COMPLETE — LIVE VERIFIED.** Checked against the running screen in `platform-sandbox` at
> live commit `6b281cd5`, Owner accepted 2026-09-04. Covers both surfaces: My Dashboard and the
> technician screen. (First accepted at `50792fef` on 2026-09-03; re-verified here against the build
> carrying the correctives that followed.)

## What this guide helps you do

Read your own dashboard correctly — including the parts of it that deliberately show no number — and
know where to go to do the actual work.

## Before you start

Nothing to set up. You land on My Dashboard when you sign in. What appears on it depends on what you
are governed to do, not on your job title.

## Why your dashboard looks different from your colleague's

**My Dashboard is not one screen with things hidden.** It is assembled for you out of the areas your
account genuinely has authority over. A module you do not see is not switched off for you — it does
not apply to you.

That distinction matters. If EOS showed you an empty "My work" panel, it would be telling you that
**you have no work**, which is a claim. Leaving it out says nothing at all, which is the truth.

Two people with the same job title can see different things, because reach comes from what they are
actually assigned — which warehouses, which accounts, which capabilities — not from the title.

## Sections, in the order they appear

| Section | What it answers |
|---|---|
| **What needs you** | Work waiting on you right now |
| **Performance against goal** | Your targets, and how you are doing against them |
| **Team performance** | Your area's work and people |
| **Drivers and exceptions** | Things that will cause problems if ignored |
| **Business impact** | Money and customers |

A section with nothing in it is not shown. An empty "Team performance" heading would imply you have
a team.

## Lists of work: "More items available"

Several panels show you **rows of real work** — reorder requests, purchase orders awaiting receipt,
opportunities, orders needing attention.

**These lists are short on purpose.** They show a handful of items so you can start working; they are
not the whole queue and they are **not a count**. If more exist, the panel says:

> More items available.

It will never say "and 12 more", because the dashboard genuinely does not know how many more there
are. Use **View all** to open the full workspace, where the complete list lives.

**Never read a dashboard list as a total.** Five rows means "here are five things", not "there are
five things".

## When a panel says nothing is waiting

If a panel says something like *"No reorder requests are waiting for review"*, that is a real answer:
EOS read the queue and it was empty.

If a panel instead says it **could not be read**, that is different and important. It does **not**
mean the queue is empty — it means nobody could look. Do not treat it as "all clear".

## Goals: target versus actual

A goal tile shows two things: the **target** somebody set for you, and the **actual** measurement.

**Not every measure has a target.** Where nobody has set one, the tile is not repeated for each
measure — you will see a single line such as *"8 further measures have no target set yet."* That is a
management gap worth knowing about, and it is deliberately not turned into a score.

Where the same measure applies to more than one location, each tile names its warehouse, so two
tiles with the same measure are not duplicates — they are different places.

Sometimes you will see a real target beside a sentence explaining that the measurement is not
connected. That is deliberate. It means the goal is real and the number to compare it against is not
available yet — and each tile tells you specifically why (for example, that a figure comes from a
working list rather than a total).

**A missing measurement is never shown as zero.** "0 of 400" would say you have done nothing. If EOS
cannot measure something, it says so instead.

A measurement that genuinely **is** zero is shown as zero, and compared normally.

## Why some figures say they are not available

EOS will not show you a number it cannot stand behind. When a figure is missing, the panel tells you
what is actually missing. The usual reasons:

- **The measurement has no agreed business definition yet.** For example, on-time completion and
  first-time fix need someone to decide what "on time" means and how a repeat visit is linked to the
  original job. Until that decision exists, EOS shows the slot and leaves it empty rather than
  inventing a score.
- **The figure would need a total that does not exist.** Some information is stored per part or per
  order, and adding it up on the dashboard would produce a number with no authority behind it.
- **Something has to be switched on** for this environment first.

Missing is not the same as zero, and it is not an error. It is EOS declining to guess.

## Money figures

Where you see billed or collected amounts:

- They cover the **current month to date**, on the company reporting calendar (America/Phoenix) — not
  your computer's calendar.
- They are shown **per company and per currency**, and are deliberately **not added together**.
  Combining the two operating companies needs a rule about business they do with each other, and
  combining currencies needs an exchange-rate policy. Neither has been decided, so EOS shows them
  separately rather than producing a total nobody agreed to.
- If the period contains more records than the read will summarize, EOS says the figure is
  unavailable rather than showing a partial amount under a complete-sounding name.

**Booked** is not shown as a figure at all. There is no governed record of booked value to total.

## The "By technician" panel

It shows each technician's open and completed work, **in name order**.

If a row reads **"Technician identity unavailable"**, that is not a person whose name is missing. It
means the work order points at a technician record that does not exist — a data problem worth
reporting. The counts are still real; the identity is not.

It is deliberately **not a ranking**. There are no scores, no positions, and no colours marking
people as good or bad. Completed jobs alone are not the whole of the work, and the panel says plainly
which quality measures are not yet available.

## Technician availability

Shows recorded working hours for today.

A technician with **no recorded schedule** is shown as "no working hours recorded" — **not** as zero
hours. EOS does not know they are unavailable; it knows nothing has been recorded.

## If you are a technician

You have your own screen rather than the general dashboard: your assigned work, your buckets (ready
to start, in progress, waiting, completed today), your all-time record, and your goals.

**Avg. Job Duration can read N/A, and that is deliberate.** It is measured from when work started to
when the job was completed, over the jobs that recorded both. If any of your completed jobs carries
timestamps that contradict each other — a completion recorded *before* the work started — EOS
withholds the whole figure rather than quietly dropping that job and averaging the rest. A number
averaged over records the platform knows are wrong would look ordinary and mean nothing. If you see
N/A persistently, that is worth reporting: it usually means a work order's timestamps need fixing.

Work comes first and performance comes after, at every screen size. That is deliberate — the screen
is for doing the job, not for watching yourself do it.

Your assigned work is **not** duplicated onto My Dashboard. It is read against your own technician
identity, and having it in two places would eventually mean two answers.

## Getting to a workspace

Use the navigation rail on the left (or the menu on a handheld). **The dashboard no longer repeats
the list of destinations** — it was duplicating what the rail already does, and it pushed the
business content off the screen.

**Everything about *you* is at the bottom of that rail**: your notifications, then your name, your
role, and **Sign out**. There is no strip across the top of the screen any more — it was showing your
email address and a second Logout button that did the same thing as Sign out, so the page now starts
at the top.

On a phone or tablet the rail is hidden until you need it. Tap the menu button at the top left; the
rail slides in with the same things at the bottom, notifications included.

**Notifications only appear if you are governed to see that queue.** If you do not have one, nothing
is hidden from you — there is nothing there for your account to look at.

Panels still link where they should: an action item links to the workspace where you resolve it, and
a work list links to the full queue behind **View all**. A link only appears when your account can
genuinely open it.

## What EOS does automatically

- Decides which modules apply to you, from your governed access — never from your job title.
- Reads every figure through the same authority that governs its own workspace, so a dashboard number
  and its workspace cannot disagree.
- Refuses to show a total it cannot support, and says why instead.
- Uses the company reporting calendar for anything dated.

## Warnings and exceptions

- **Do not use a dashboard list as a count.** Use the workspace behind **View all**.
- **"Could not be read" is not "nothing waiting."** Re-check, or open the workspace.
- **A blank measurement is not a zero.** Do not report it as one.
- If a figure looks wrong, open the workspace it came from. The workspace is the authority; the
  dashboard only arranges what the workspace already knows.

## If something looks wrong

1. Open the workspace behind the panel and compare.
2. If they disagree, record what you saw on each screen and raise it — a dashboard figure should
   never disagree with its own workspace.
3. If a module you expect is missing, your account may not be governed to it. Ask an administrator to
   check your role, capabilities and assigned locations in **Administration → Employees**.

## Related guides

- `docs/training/TECHNICIAN_RECORDING_PART_USAGE.md`
- `docs/training/PURCHASING_RECORD_PURCHASE_ORDER.md`
