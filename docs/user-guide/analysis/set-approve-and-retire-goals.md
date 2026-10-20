# Set, approve, replace and retire a goal

**Status: live on the nonprod EOS build; production only when the Owner says so**

**What this lets you do:** Set a **target** (a goal) for a measure the platform can state, have someone else approve it, replace it with a new target that starts later, or retire it when you stop measuring it. A goal is only ever a target. The figure it is compared with always comes from the page that measures it.

**Who can do it:** Owner, General Manager, Operations Manager, Sales Manager, Field Manager, Parts Manager, Warehouse Manager and Administrators. Everyone else keeps seeing their targets on their dashboard, but has no **Analysis > Goals** page. If you cannot do a step, you will not see its button at all.

Two things to know: a target for the **whole firm** is firm-wide, not limited to one company; and an Administrator whose account is not linked to an employee record sees the page but is refused, because working on goals needs an employee's company access.

## The rules to know first
- **A draft is not a target.** A new goal is saved as a **Draft** and does nothing until it is approved.
- **Someone else approves it.** You can never approve a draft you set yourself, even if your role allows approving. The page tells you so instead of showing a button. "Someone else" means another **person**: a different sign-in linked to the same employee record does not count.
- **Approving asks for a reason**, and so does retiring. A decision without a reason is not accepted.
- **You never set your own target.** An employee does not set, approve or retire a target for themselves. A target for you is set by someone above you.
- **History is never rewritten.** Replacing or retiring a goal closes its dates. It does not edit the number. The old version stays on the page with the dates it applied.
- **You can only reach what you are responsible for:** the companies you work for, the warehouses you are assigned to, and the people beneath you. Something outside that is simply not offered, and if you somehow ask for it the answer is the same as for something that does not exist.

## Look at a target
1. Open **Analysis > Goals**.
2. Under **Choose a target**, pick the **Measure**. Only measures you have authority over are listed.
3. Pick **For**: the whole firm, an operating company, a warehouse or an employee. Each measure offers only the places it can be set for.
4. If you chose a company, warehouse or employee, pick which one. The employee list shows people beneath you, never yourself.
5. Choose **Show this target**.

You see every version, oldest first: the version number, its **Status**, the target (for example "At most 5", or "At least 12500.00 USD"), the dates it applies, who set it and who approved it. The status says what the version is **today**:

| Status | What it means |
|---|---|
| **Draft** | Saved, not approved. It applies to nothing. |
| **Scheduled** | Approved, but its start date has not come yet. It is **not** in force. The target before it keeps applying until the day before it starts. |
| **In force** | Approved, and its start date has come. This is the target that applies today. |
| **In force until <date>** | **Replaced** by a newer target, but the newer one starts after today, so this one still applies up to the date shown. |
| **Replaced** | A newer target took over. Its dates stay on record: the days it covered still belong to it. |
| **Replaced before it started** | It was scheduled, and its replacement was approved before it ever began. It never applied on any day. It stays on record. |
| **Retired** | Stopped with no replacement (or a discarded draft). The days before it was retired still belong to it. |

## Set a target
1. Show the target as above, then choose **Set a target**.
2. Enter the **Target**. A count is a whole number. An amount is dollars and cents (for example `12500.00`) with a three-letter currency.
3. Choose whether the result counts as met **at least**, **at most** or **exactly** the target. Some measures allow only one choice, and it is already chosen for you.
4. Choose the date it **takes effect**. Optionally choose when it **ends**. Leave that blank for a target that applies until it is replaced or retired.
5. Choose **Save draft**.

You will see "Saved the target as a draft." Someone else now approves it. If a target is already in force for any part of those dates, the page tells you; use **Replace** on the one in force instead.

## Approve a draft
1. Show the target. Find the **Draft** that someone else set and choose **Approve**.
2. Say **why** it is approved and choose **Confirm approval**.

The target is in force from its start date. If it replaces an earlier target, that one is marked **Replaced** and ends the day before.

## Replace a target
1. Find the target that is **In force** and choose **Replace**.
2. Enter the new target and a **Takes effect on** date that is **after** the day the current target began.
3. Choose **Save draft**, and have someone else approve it as above.

Until it is approved, the current target stands. The moment it is approved, the old target ends the day before the new one starts, so there is never a day with two targets.

If the new target starts in the future, it shows as **Scheduled**, and the old one keeps applying (**In force until** the day before) right up to the start date. There is no day without a target in between.

## Correct a scheduled target
A target that shows **Scheduled** has been approved but has not started. It **cannot be retired**: its history is not rewritten. If it is wrong (the number or the start date), replace it:
1. Find the **Scheduled** target and choose **Replace**.
2. Enter the corrected target. The **Takes effect on** date must be **after today**, but it may be earlier or later than the scheduled one's start. A day that has already passed keeps the target that applied then.
3. Choose **Save draft**. Someone else approves it, with a reason, exactly as for any replacement.

When it is approved, the scheduled target is marked **Replaced before it started**: it stays on record and never applies on any day. The target that is in force now carries on until the day before the corrected start date. So if the start moves earlier, the change happens sooner; if it moves later, the current target simply lasts longer. Either way there is one target on every day and no gap.

If the scheduled target has already started by the time the replacement is approved, it is an ordinary replacement: the old one ends the day before, and the days it applied still belong to it.

## Retire a target
1. Find the target that is **In force** and choose **Retire**.
2. Say why and choose **Confirm retirement**.

The target ends today. It stays on the page as **Retired**. Retiring means "we stopped measuring this". Replacing means "we changed the number". A **Scheduled** target has no **Retire** button; correct it with **Replace** instead (see above).

## Discard a draft
A draft that should not go ahead (entered by mistake, or copied from the previous system) is removed from play with **Discard**:
1. Show the target and find the **Draft**, then choose **Discard**.
2. Say why and choose **Confirm discard**.

The draft is kept on the page as **Retired**. It was never a target and nothing was ever measured against it. A draft copied from the previous system cannot be approved here, so it has no **Approve** button; discard it and set the target again.

## If something is refused
The page shows the platform's own sentence and changes nothing. The common ones:
- **The author of a goal version may not approve it.** Ask someone else.
- **An employee does not manage their own target.** Ask someone above you.
- **That target is outside your authority.** It is not one you are responsible for.
- **A target already covers part of that window.** Replace the one in force instead.
- **Only a draft may be approved / only an approved goal may be retired.** Someone already acted on it; show the target again to see where it stands.
- **This target hasn't started yet, so it can't be retired.** It is Scheduled. Set a corrective replacement for someone else to approve.
- **A replacement for a target that has not started must take effect after today.** Choose a later start date; a day that has passed keeps the target that applied.

If the page says it could not save, nothing was changed. Try again: your retry will not create a second draft.

## What this does not do
- It does not edit a target's number. To change a number, replace the target.
- It does not delete anything. A draft nobody approves does nothing, and a discarded draft stays on record as Retired.
- It does not set targets for a business unit or a team. Those are not available on EOS.
- It does not change the figure a target is compared with.

See also [Performance goals](../performance-goals.md), where targets appear next to the figures.
