# See why someone can or cannot do something (Access explained)

**Who can use this:** an Administrator (the same people who can open **Effective Access** on an Employee).
**What it changes:** nothing. It only reads and shows.

## When to use it

A person says "I cannot do X" or "I can see this and should not". Instead of opening the sign-in panel, then Roles, then
Company Access, then Work Eligibility, open one page and ask.

## Steps

1. Go to **Administration, Employees & Users**, and open the person.
2. Open the **Access explained** tab.
3. The page first shows the person overall: sign-in, principal, employment, company and pages offered.
4. To ask about a specific thing, pick **Question**:
   - **An action on an object**: choose the object (for example Work Order) and the action (for example Dispatch). If you
     are asking about one record, type the record's company, warehouse or sales channel. Leave them empty if you do not have one.
   - **A page**: choose the page.
5. Press **Explain**.

## How to read the answer

The page lists eleven checks in the order EOS applies them. **The first check that refuses stops the request**, so the
checks after it say **Not evaluated**.

| Word | Meaning |
|---|---|
| Pass | This check lets the request through. |
| Fail | This check refuses. It is the reason. |
| Not applicable | The check does not apply to this question. |
| Not evaluated | An earlier check already refused, or you have not asked a question that needs it yet. |
| Not covered | EOS cannot answer this check here yet. It is not a pass. |

At the top, a red line names the first refusal in plain words, for example:

> Blocked at: Record access. They are scoped to sales channel RETAIL; this record is in NATIONAL_ACCOUNTS.

Each check also lists the **setting that decides it**, its **current value** and **where it lives**, so you know what to
change. This page does not change anything itself: use the screen named for that setting (Security Roles, Company Access,
EOS Sign-in, Employee profile, and so on).

## The eleven checks

1. **Sign-in**: the sign-in account is active, not locked, and two-step verification is set up if required.
2. **Principal and tenant**: the login belongs to an active principal in one active tenant.
3. **Employment eligibility**: the Employee is Active or Contractor. On Leave, Inactive and Terminated people have no access even though their roles are still assigned.
4. **Company**: the record's company is one this person may see or act in.
5. **Activation**: whether the feature is switched on. **Not covered today.**
6. **Door**: the page is offered. A page is only a door; the data behind it is checked again.
7. **Object**: a role or a direct exception grants the action.
8. **Field**: whether a field is restricted. **Not covered today.**
9. **Record access**: the record is inside the person's reach (the channel, company or other scope they hold it in).
10. **Process**: for a step in a published process, a role the person holds is bound to that step.
11. **System**: protected-administrator rules. **Not covered today**, because those rules apply when a change is made.

## If the page says it is unavailable

This EOS service does not serve Access explained. Nothing is shown rather than an answer worked out somewhere else.
