# Find and manage users

**What this lets you do:** Look up anyone in your company, see their profile and access at a glance,
open their record, and — where your account is authorised — correct their details.

**Who can do it:** Admins and dispatchers. (Technicians do not see the Administration area.)

> **Employees and Users are now one screen.** Administration used to have two people destinations.
> There is one now, called **Users**, and it shows the same people the Employees screen showed. Old
> links to `/administration` or `/administration/employees` still work — they take you to Users.

## Before you start

- Sign in with an admin or dispatcher account.
- Know roughly who you are looking for. The list is sorted by name.

## Find someone

1. In the top navigation, open **Administration**, then choose **Users**.
2. Scan the table. Each row shows:
   - **Name** — the person's name.
   - **Employment Status** — Active, On Leave, Inactive, Terminated, Retired or Contractor.
   - **Operational Roles** — what they are eligible to do operationally, such as Technician or
     Parts Manager. This is *not* their security role.
   - **EOS Access** — **Account linked** if they have an EOS sign-in, **No account** if they do not.
   - **Security Role** — Admin, Dispatcher or Technician.
3. If the list is long, select **Load more** at the bottom to fetch the next page.

## Open someone's record

Select the person's **name**, or anywhere on their row, or the **View** button. Their record opens
**read-only** — nothing becomes editable just because you clicked.

The record answers, in order:

- **Identity & contact** — first, middle, last and preferred name, their Employee ID, work email,
  work and mobile phone, and address.
- **Employment** — employment status, job title, operating company, hire and separation dates, and
  their **Manager**. The manager's name is a link: select it to jump to that person's own record.
- **Operational assignment** — the operational roles they hold.
- **EOS access & security** — whether they have an EOS account, their security role, and the
  administrative actions.
- **Change History** — at the bottom. See below.

Anything the record does not have says so — "Not recorded" — rather than showing a blank.

## Change someone's details

1. Open their record.
2. Select **Edit User** (or use **Edit** directly from the list, which opens the same form).
3. Change what you need. You can edit names, Employee ID, contact details, address, job title,
   manager, operating company, hire and separation dates, employment status and operational roles.
4. Select **Save**, or **Cancel** to discard everything you typed.

Only the fields you actually changed are sent. Each change is recorded separately in Change History.

## Read the Change History

Every record ends with **Change History** — what changed, when, from what, to what, and who did it.
It shows the recorded, audited history; it is not assembled from what happens to be on your screen.

- Newest changes are at the top.
- **Field** filters to one kind of change ("Job Title", "EOS Access Status"). The options come from
  what this person's history actually contains, so you will not see a filter that matches nothing.
- **Changed by** filters to one person, and **From** / **To** limit it to a date range. Both ends of
  the range are included.
- Select any column heading to sort by it. The first select sorts ascending, the next descending.

## Tips and common problems

- **"Employment Status" and "EOS Access" are different things, on purpose.** Marking someone
  Terminated does *not* switch their EOS account off, and disabling an account does *not* change
  their employment record. Each is its own deliberate action.
- **Operational roles are not access.** Adding "Parts Manager" makes someone eligible for that kind
  of work. It does not change what they are permitted to do — that is their security role.
- **You cannot change a security role here.** The Security Role shown on a user's record is a copy
  of their sign-in role, kept for reference. Changing it is done through Roles & Permissions.
- **"Account status: Not available."** Whether an EOS account is switched on or off is held by the
  sign-in system, and this screen has no way to read it for another person. It says so rather than
  guessing.
- **Enable Account / Disable Account are locked, with a padlock.** Hover or focus the button to read
  why. These need a governed access grant that is not issued in any environment yet.
- **Send password reset is not showing.** It appears only for accounts authorised to initiate one.
  When it is available, the person receives an email and sets their own new password — you never see
  their password, a reset link, or a code, and a routine reset does not sign them out.
- **"Change history unavailable."** The trusted history service is not deployed and verified yet.
  That is not the same as "nothing has ever changed", and the screen deliberately does not claim it.
- **Employee ID is blank for some people.** That field is your own employee number, and nobody was
  given one automatically. Fill it in when you edit the record.
- **No "New user" button.** Adding a person to EOS links them to a sign-in account, which an
  administrator does through the onboarding procedure rather than from this screen.

## Related

- [See who can do what](./see-who-can-do-what.md)
- [See what a role can do](./see-what-a-role-can-do.md)
