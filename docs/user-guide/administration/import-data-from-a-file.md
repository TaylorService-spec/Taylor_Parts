# Import data from a file

**Administration → Data Import**

Load your existing Parts, Customers, Equipment, stock counts and past service records into EOS from
a spreadsheet, instead of typing them in one at a time.

> **Sandbox only.** This screen works in the sandbox and nowhere else. It is switched off in the
> live system — not by a setting somebody could change by accident, but in the code itself, which
> refuses before it even checks who is asking. If you open it somewhere it is not available, it says
> so rather than showing you an empty screen.

## Before you start

- Your file must be a **.csv** or **.xlsx**, up to 2 MB and 5,000 rows.
- The **first row must be a header row** naming each column. That is how EOS works out which value
  is which, so a file that starts straight into data cannot be read.
- Each column name must be different from the others. A header that repeats a name is refused,
  because every value under the second one would be filed in the wrong place.
- **Import the entities in order**: Customers first, then Equipment and Service History (which need
  a customer to attach to), and Parts before stock counts. EOS never invents a missing record.

## How it goes

Choose a file → see what EOS understood → look at what it would do → approve → see what it did.

**Nothing is written until you approve.** Reading the file, matching the columns and checking every
row all happen first, and none of it changes anything. You can walk away at any point before the
approve button, and nothing will have happened.

### 1. Choose a file

Pick the file. EOS reads it and works out which kind of record it holds from the column names.

If it cannot tell — or if two kinds fit equally well — it asks you rather than guessing. A wrong
guess would file a whole spreadsheet under the wrong thing, quietly, so it does not guess.

### 2. Check the columns

EOS matches your column names to its own fields, including common variations: `PART_NO`,
`Part Number` and `SKU` all mean the same thing to it.

If a **required** field has no column, the import stops here and tells you which one is missing. Add
the column to your file and choose it again. It will not import "most" of a record.

### 3. Read the preview

Every row appears with what will happen to it:

| | Meaning |
|---|---|
| **Will import** | The row is fine. |
| **Will import**, with a note | The row imports, but something is worth knowing — a customer with no billing address, a count of zero. |
| **Will not import** | The row is refused, with the reason. |

**Rows that will not import are shown, not hidden.** An import that quietly dropped what it could
not handle would leave you believing it all worked.

Two things are always refused:

- **The same record twice in one file.** The file contradicts itself and nothing can choose which
  line is right.
- **A record that already exists.** Import only ever *creates*. It will never overwrite what is
  already in EOS from a spreadsheet, so a re-run of the same file is safe — it just refuses
  everything.

### 4. Approve

The button says exactly what approving does, and it differs by what you are importing. Read that
line: it is the difference between adding a catalogue entry and writing a stock movement.

### 5. See what happened

You get counts and, if anything failed, the reason for each row. A partial import is reported as a
partial import — never rounded up.

**Import history** at the bottom of the screen lists every run, what was imported and how many
records it wrote.

---

## What each kind of import does

### Customers

Creates new customers. **Payment terms and tax status are not imported** and stay unset — a tax
status is a fact about a legal relationship, evidenced by a certificate somebody holds, and not
something a column in an old export can establish. Set those in EOS afterwards.

The customer's **name** is what EOS matches on. A customer already in EOS with that name is refused
as an existing record, however they were created.

### Parts

Creates new Parts in **DRAFT** status. A spreadsheet can say a Part is active but cannot
substantiate it, so activating a Part stays a separate step done in EOS.

Units are translated where the meaning is unambiguous — `EA`, `PC` and `PCS` all become `EACH` —
and refused where it is not.

### Equipment

Creates ACTIVE Equipment under the customer and location each row names. **Both must already exist**,
and the location must belong to that customer. A row naming a customer EOS has never heard of is
refused; it will not invent one from a column.

A **serial number is required**, even though EOS itself does not require one for equipment added by
hand. Without it, two identical machines at one customer cannot be told apart, so re-running the
import would create them all over again. Serial numbers are compared ignoring spaces and capitals,
and a serial already registered to any machine is refused.

Dates must be written **YYYY-MM-DD**. `03/04/2026` is the 3rd of April in most of the world and the
4th of March in the United States, and nothing in a spreadsheet says which — so it is refused rather
than guessed.

### Inventory

This one is different from the others: it does not create a record. It writes an **opening balance**
— the one entry that says what was on the shelf when you started counting in EOS.

- The Part and the warehouse must already exist, and the warehouse must be active.
- Counts are **whole numbers, zero or more**. A fraction is refused rather than rounded.
- **Zero is fine** and means something real: "we stock this here and have none." Nothing is written
  for it, because nothing moved.
- **Only one opening balance per part per warehouse.** If a part has already moved at that
  warehouse — or already has an opening balance — the row is refused. Correcting a count afterwards
  is a cycle count, not another import.
- Serial- and lot-tracked parts are refused. Their balance is a list of individual units, not a
  number.

An opening balance is not a receipt (nothing was received) and not an adjustment (it is the point
adjustments are measured *from*).

### Service history

Records service that was performed **in your old system**, before EOS.

These are **not Work Orders**, deliberately. A Work Order in EOS is a live thing — scheduled,
assigned, worked, closed — and a record of a job done in 2019 went through none of that. Importing
them as Work Orders would put jobs into your completion rates and technician job counts that nobody
ever worked here.

So each one is stored as what it is: a record of past service, marked as imported, attached to the
customer. The **technician stays a name** rather than being linked to an employee — matching a name
would credit somebody else's work to a real person — and the **equipment serial stays text**,
because the machine may since have been replaced.

A **future date is refused**. This imports what has already happened; work still to be done is a
Work Order.

Include the old system's job or ticket number if you have it. Without it the record still imports,
but nobody can trace it back to the job it came from.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| "Data Import is not available in this environment" | You are not in the sandbox. It cannot be turned on here. |
| "Data Import is not available to you" | The screen names the permission you need. Ask for that one. |
| The approve button is locked with a reason | Looking at a preview and running an import are two separate permissions. |
| "This file cannot be imported as mapped" | A required column is missing. Add it and choose the file again. |
| "The entity could not be detected" | Your column names are too far from anything EOS recognises. Choose the type yourself. |
| "This workbook is password-protected" | Save a copy without a password. |
| Everything is refused as already existing | The file has already been imported. That is the safe answer. |

## What import will never do

- Overwrite an existing record.
- Create a customer, location, Part or warehouse a row happens to mention.
- Set a governed field a spreadsheet cannot substantiate — tax status, payment terms, an active
  Part, a retired machine.
- Calculate anything in your spreadsheet. Only the values Excel already saved are read; formulas are
  never run.
- Write anything at all before you approve it.
