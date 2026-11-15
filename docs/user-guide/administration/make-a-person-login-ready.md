# Make a person login-ready

**What this lets you do:** Give an Employee who has no sign-in yet their EOS sign-in in one step, and get a one-time
setup code to hand to them.

**Who can do it:** Only people who have been given this specific permission by the Owner (`admin.loginReadyPerson.provision`)
**and** who can already assign Security Roles. **Nobody has this permission when it ships.** Until the Owner grants it,
the **Make login-ready** button does not appear for anyone, including the Administrator and the Owner.

## What it does, and what it does not do

It creates the person's EOS identity, adds them to your company, links it to their Employee record, and creates a
sign-in that is waiting for first-time setup. It does **not** give them any Role, permission or access. After this,
the person can sign in and set up their password and authenticator, and they will see nothing until you assign them
a Role on the same record (**Roles & Access**).

## Before you start

- The Employee record must already exist (create it first under **Administration ▸ Users**).
- Their status must be **Active** or **Contractor**, and they must have no separation date.
- They must not already have a linked sign-in. If they do, use **Create sign-in** under EOS Sign-in instead.

## Steps

1. Open **Administration ▸ Users** and open the person's Employee record.
2. Go to the **Roles & Access** tab and find the **User Access** section. It says **No User Access**.
3. Choose **Make login-ready**.
4. Check the **Sign-in name**. If the Employee has a work email, it is filled in and cannot be changed (the sign-in
   name must be that email). If they have none, type one.
5. Type a **Reason**. It is recorded in the audit trail.
6. Choose **Make login-ready**.
7. A **Setup code** appears. Give it to the person directly, in person or by phone. It is shown **once**, expires
   at the time shown, and is not saved anywhere you can read it back. Choose **Done** when you have passed it on.

The person then signs in, uses the code to choose a password, and sets up their authenticator (two-step
verification is required for everyone).

## If something goes wrong

| Message | What it means |
|---|---|
| `EMPLOYEE_NOT_ELIGIBLE` | Only Active or Contractor Employees can be made login-ready. On Leave, Inactive, Terminated and Retired are refused. |
| `EMPLOYEE_SEPARATED` | The Employee has a separation date. |
| `ALREADY_LINKED` | The Employee already has a linked sign-in. Nothing was created. |
| `LOGIN_RETIRED` | A sign-in with that name was removed earlier and is never silently re-created. |
| Sign-in name in use | Another person already uses that sign-in name. |
| The sign-in name must be the Employee's own work email | Use the email on the record, or change the work email first. |

A refusal creates nothing. If you lose the setup code, open **EOS Sign-in** on the same record and choose **New setup code**.
