# Find and manage users

**What this lets you do:** Look up anyone in your company, open their Employee record, and — where your account
is authorised — correct their details.

**Who can do it:** People whose Security Roles give them `Administration ▸ Users`. By default the Administrator,
the Owner and the General Manager can **read** Employee records; only the Administrator and the Owner can **edit**
them. (A Dispatcher or Technician does not see the Administration area.)

> **Access is administered on the same record.** Security Roles, Effective Access, Direct Exceptions and the
> other access sections of an Employee record are covered in the canonical Administration guide:
> [Administration: Policy and Access](../../training/administration-policy-and-access.md). This page covers
> finding people and keeping their Employee details correct.

> **Employees and Users are one screen.** Old links to `/administration` or `/administration/employees` take you
> to Users.

## Before you start

- Sign in with an account that can open `Administration ▸ Users` (see above).
- Know roughly who you are looking for. The list is sorted by name.

## Find someone

1. In the top navigation, open **Administration**, then choose **Users**.
2. Scan the table. Each row shows:
   - **Name** — the person's name.
   - **Employee ID** — your own employee number, or *Not recorded*.
   - **Employment Status** — Active, On Leave, Inactive, Terminated, Retired or Contractor.
   - **Job Title** — descriptive only; a job title grants no permission and sets no role.
   - **Operating Company** — the company the person works for.
3. If the list is long, select **Load more** at the bottom to fetch the next page.
4. **N Employees have no Job Role** above the table counts people without a Job Role; **Show Employees without a
   Job Role** lists them.

## Open someone's record

Select **View** (or the person's name). The record opens **read-only** — nothing becomes editable just because you
opened it. It shows, in order:

- **Identity & contact** — first, middle, last and preferred name, Employee ID, work email, work and mobile phone,
  and address.
- **Employment & business context** — employment status, job title, operating company, hire and separation
  dates, and **Manager** (a link to that person's record).
- **Job Role** — the person's business position, with its history. *It does not change access.*
- **Security Roles**, **Work Eligibility**, **Operational Scope**, **Functional Roles**, **User Access**,
  **Direct Exceptions**, **Effective Access** and **Workflow responsibilities** — the person's access and
  responsibilities, administered as described in the
  [Administration guide](../../training/administration-policy-and-access.md).
- **Change History** — governed changes to the Employee record (see below), followed by **Legacy Change
  History**, the pre-cutover record kept for reference, and **Access Audit History** — Security Role and
  direct-grant events for this person.

Anything the record does not have says so — "Not recorded" — rather than showing a blank.

## Change someone's details

1. Open their record.
2. Select **Edit Employee** (or use **Edit** directly from the list, which opens the same form).
3. Change what you need: display, preferred, first, middle and last name; Employee ID; work email; work and mobile
   phone; address; **Job Title**; **Manager**; **Hire Date** and **Separation Date**.
4. Select **Save**, or **Cancel** to discard everything you typed.

Employment Status and Operating Company are **not edited on this form** yet. Security Roles, Job Role, Work
Eligibility and Operational Scope are changed in their own sections of the record, each with its own reason — not
here. Recording a separation date does not change Employment Status or disable the person's EOS account.

## Read the Change History

**Change History** is the governed audit of changes to the Employee record — what changed, when, from what, to
what, who did it, and the reason.

- **Field** filters to one kind of change (for example "Manager"). The options come from what this person's
  history actually contains.
- **Changed by** filters to one person, and **From** / **To** limit it to a date range.
- Select a column heading to sort by it.

Manager and Job Role names are shown as they are named today, not as they were named at the time of the change.

## Tips and common problems

- **Employment status and EOS access are different things, on purpose.** Marking someone Terminated does *not*
  switch their EOS account off, and disabling an account does *not* change their employment record.
- **A Job Role is not access, and neither is Work Eligibility or Operational Scope.** What a person may do comes
  from their Security Roles — see the [Administration guide](../../training/administration-policy-and-access.md)
  and the person's **Effective Access**.
- **Security Roles are changed on the Employee record**, in its **Security Roles** section, with a required reason
  — not on the Users list and not in Roles & Permissions.
- **Employee ID is blank for some people.** That field is your own employee number, and nobody was given one
  automatically. Fill it in when you edit the record.
- **"That Employee ID is already held by another Employee. Choose a different one."** Employee IDs are unique —
  one number belongs to one person, and upper and lower case count as the same number. Pick a different one, or
  clear it from whoever holds it first.
- **The Employee ID box rejects what you typed.** Use up to 32 letters, digits, dots, underscores or hyphens,
  starting with a letter or digit. No spaces and no slashes.
- **No "New user" button.** Adding a person to EOS links them to a sign-in account, which is done through the
  onboarding procedure rather than from this screen.

## Related

- [Administration: Policy and Access](../../training/administration-policy-and-access.md) — Security Roles, Object
  Security, Effective Access, Direct Exceptions, Functional Roles, workflows and the protected Owner.
