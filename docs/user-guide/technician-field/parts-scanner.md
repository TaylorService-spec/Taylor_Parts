# Parts Scanner (Technician Workspace)

**Status: live** (technician, admin) · Service > Technician Workspace

Scan a part on the job and record that you used it — without leaving the work order.

## What it does

The Scanner answers three questions and then gets out of the way:

1. **What did I scan?** — it resolves the code to a real record, or tells you honestly that it
   couldn't.
2. **Can I see it?** — it searches only what you're actually allowed to read.
3. **What can I do with it?** — it offers only actions the system will genuinely accept.

## Steps

1. Open **Service > Technician Workspace**.
2. Scan a code, or type it in.
3. Read the result card. It shows the part's **name** (not the code you just typed back at you),
   its human code, how many are planned on this job, and which job that is.
4. If the part is planned on your current job, set the quantity with **−** / **+** and press the
   record button.

## Recording part usage

This is the Scanner's one action, and it works when all four are true:

- you're signed in as a **technician**
- the work order is **assigned to you**
- you have an **active** work order
- the part is **planned** on that job

If any of these isn't true, the button is shown disabled with the specific reason — "This work
order is not assigned to you", "This part is not planned on your current job". It never silently
does nothing.

The server checks all four again independently. The Scanner never decides on its own.

## What you might see

| Message | What it means |
|---|---|
| "That code couldn't be read." | The scan didn't produce a usable code. Try again or type it. |
| "That code matches more than one record." | Pick the right one from the list shown. |
| A "not found" message | It isn't in **what you can see** — which is not the same as not existing. The message says which. |
| "Your work orders couldn't be loaded…" | A read failed. This is a failure, not an empty scanner. |
| "Nothing to do with this here." | It resolved fine; there's just no action for it in this context. |

## What it does not do

The Scanner **does not receive stock, load trucks, run cycle counts, or draft purchase orders.**

An earlier version showed those five actions to everyone, always, against sample parts held in
memory. They looked real and stored nothing. They were removed deliberately when the Scanner was
rebuilt on the real governed data.

To receive stock, use **Inventory > Receiving** — see
[Receive a purchase order](../inventory/receive-a-purchase-order.md). That is the only place the
governed receipt happens.
