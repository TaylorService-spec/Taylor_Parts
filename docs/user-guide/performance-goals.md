# Performance goals

**Dashboard → My Dashboard** (goal tiles) and the technician screen (**Performance against goal**)

See the target set for a figure right next to the figure itself, so you can tell at a glance whether
you are on track.

> **Goals are not created in EOS screens yet.** Goals are authored today in the old system. EOS reads
> them and shows them; it does not yet let you create or change one. On **Financials → Goal
> Management** the **New Goal** button is switched off, and the page says goal changes are not wired to
> that screen and that no goal records exist yet. If you need a target set or changed, ask the person
> who manages goals.

## Where you see targets

| Where | What it shows |
|---|---|
| **Dashboard → My Dashboard**, section **My goals** | Targets set for you personally. If there are none: "No individual goals are set for you." |
| **Dashboard → My Dashboard**, section **Goals for your area** | Targets for your company and for the warehouse(s) you work in. Shown if you work in operations or are assigned to a warehouse. If there are none: "No goals are set for your area." |
| Technician screen, **Performance against goal** | A technician's own targets (work orders completed, open assigned work). If your account is not linked to an employee record, it says so and that an administrator can link it in Administration > Employees. |

Which tiles you get depends on your role and where you work; you will not see every measure.

## Read a goal tile

Each tile is named for what it measures (for example "Work orders completed", "Past due scheduled
work", "Active accounts", "Open reorder requests"). When the same measure is set for several
warehouses, the warehouse name is added after a dash so the tiles are not mistaken for duplicates.

A tile with a target and a figure shows the figure large, then the target, for example
"Open now · target at most 5". The words after "target" are **at least**, **at most** or **exactly**.
It also shows a status word, **Met** or **Below target**, and, where it makes sense, how much is
"remaining to goal" or "over target".

A target is only ever a target. The figure itself comes from the page's own data for that measure, not
from the goal.

## Three different "no number" messages

These are three different situations. Do not read them as the same thing.

| You see | It means | What to do |
|---|---|---|
| **No target has been set.** | Nobody has set a target for this measure. Nothing is wrong. | If you think you should have one, ask the person who manages goals. |
| **This target is outside your access.** (or, for the whole panel, "Your access does not include performance targets.") | A target may exist, but you are not allowed to see it. It is deliberately shown, so "I may not see it" is never mistaken for "there isn't one". | Ask an administrator if you believe you need it. |
| **Targets could not be read just now.** | The goals could not be loaded this time. Your other work is unaffected. | Reload the page and try again later. |

Two more you may meet:

- **Not Measured Yet** — the target is real and shown, but the figure for that measure is not available
  yet, and the tile says why. It never shows a made-up zero. Only some measures are connected to a live
  figure so far, so several tiles show a target with this status.
- **Target Unavailable** — a target exists but its history is contradictory, so it cannot be shown
  safely. Tell an administrator.

When many measures have no target at all, they are not shown as a wall of "No target has been set"
tiles. Instead one line counts them, for example "3 further measures have no target set yet."

## Targets are for a period

A target applies to a period and keeps that period's value. If a new target is approved later, the
earlier month still shows the target that applied then: a September target stays September's. The tiles
show the target that applies on the day you are looking.

## Which targets you can see

- The targets of **your own company**.
- The targets of **your own warehouse**.
- **Your own** employee targets, and those of the people who report to you.
- A manager sees people in their **own company** beneath them in the organisation, never another
  company's.

## Related

- [Build and save a report](./administration/build-and-save-a-report.md)
- [Working with no signal](./working-with-no-signal.md)
