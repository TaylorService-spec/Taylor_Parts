# Set up warehouse racking

**Administration → Warehouse Racking**

Describe a warehouse's racking once and create all of its bins in one pass, instead of adding them
one at a time.

A bin is a **place**: a shelf position you can point at. It is not a stock balance. Nothing on this
screen says how much is in a bin — that is tracked separately.

> **Not turned on yet.** Both bin permissions are switched off across the whole system and are not
> granted to any role, so today this screen tells you which permission you are missing instead of
> letting you read or change anything. That is not a fault. Reading the rack and changing it are two
> separate permissions, so you may end up able to see the bins but not edit them.

## How a bin is described

Every bin has four parts, and together they make its code:

| Part | What it is | Example |
|---|---|---|
| Area | The part of the warehouse | `PARTS ROOM` |
| Aisle | One or two letters | `A` |
| Bay | The upright section along the aisle | `1` |
| Position | The shelf within that bay | `3` |

That bin's code is **A01-003**. The code is written by the system, not by you — which is why you
never type one.

## Create a whole rack

1. Pick the **Warehouse**. Bin codes are unique inside one warehouse, never across the company.
2. Type the **Area**. Spaces become underscores and letters become capitals as you go, so what you
   see is what gets saved.
3. Choose the **Aisles** — either a range of letters (`A` to `F`) or a specific list
   (`A, B, D, F`) when your racking skips letters.
4. Enter how many **bays** are in each aisle and how many **positions** are in each bay.
5. Click **Preview these bins**.

### Why positions are numbered 1, 3, 5

New racking is numbered with odd numbers, leaving the even numbers free. When someone later adds a
shelf between two existing ones, it becomes 002 and nothing else has to be relabelled.

You can still use an even number whenever you want one — see *Add one bin* below.

## Read the preview

Nothing has been created yet. Each row shows the code the system would give the bin and what would
actually happen:

| It says | It means |
|---|---|
| **New** | It will be created. |
| **Already exists** | This exact bin is already there. Applying again changes nothing. |
| **Code taken** | Another bin already holds that code. This one cannot be created. |
| **Invalid** | The system refused the location — usually a bad area or aisle. |
| **Needs attention** | The stored record is inconsistent. Don't apply; raise it. |

These verdicts come from the system itself, not from a guess made on your screen. If the system
cannot be reached, you get an error instead of verdicts — never a green light.

**Changing any box clears the preview.** That is deliberate: an answer to the rack you described a
minute ago is not an answer to the one on screen now.

## Create the bins

Click **Create N bins**. Only the rows marked *New* are created.

Bins are created one at a time, a few at once, so **some can succeed while others fail** — for
example if someone else is configuring the same aisle. That is normal, not an error. The result
table gives one line per bin: *Created*, *Already there*, or *Not created* with the reason.

If a bin says *Already there*, you have not created a duplicate. Running the same layout twice is
safe.

## Add one bin

For a single shelf added to racking that already exists. Fill in the aisle, bay and position, then
**Preview this bin** and create it. Even numbers are allowed here: 002 sits between 001 and 003.

A bin you add by hand is the *same bin* the generator would have made for that spot, so re-running
the layout later will report it as already there rather than clashing with it.

## Change a bin that already exists

- **Rename** gives a bin a friendly name (`Fast movers`). Correcting a bin's code keeps the same
  bin, so labels and history still point at the right place.
- **Deactivate** takes a bin out of use — the list then shows it as *Out of use*. **Reactivate**
  brings it back to *In use*.

There is no delete. A bin's code stays reserved to it permanently, so an old printed label can never
quietly start meaning somewhere else.

## What this screen does not do

- It does not show or change quantities, stock or who owns what.
- It does not create warehouses. That is a separate job with its own approval.
- It does not print labels.
- It does not let you change the code format.
