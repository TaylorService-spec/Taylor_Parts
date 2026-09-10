# Administration: Policy and Access — EOS User Guide

**Audience:** Taylor EOS Administrator (all parts) · Owner and General Manager (Part 3, assigning Roles)
**Applies to:** `Administration ▸ Roles & Permissions`, `Administration ▸ Objects`, `Administration ▸ Users` (the **Stored role assignments** panel), `Administration ▸ Workflows`
**Training represents:** frontend `0c733704` · EOS API `44f423c9`
**Effective date:** 2026-09-10
**Environment:** non-production — `https://verenwardeos.vercel.app`, tenant `taylor-nonprod`
**Owner:** Verenward product training

## What this guide helps you do

As the Taylor EOS Administrator for Taylor Freezer of Arizona, you decide **what each Role may do** and
**who holds which Role**. This guide covers the four Administration screens where that is configured:

- **Roles & Permissions** — create a Role, and set what it may Create, Read, Edit and Delete on each
  kind of record, down to individual fields.
- **Objects** — rename the kinds of records EOS works with, and add fields of your own.
- **Users** — give a person a Role, or take one away.
- **Workflows** — see the business processes EOS knows about. This screen is read-only today.

Grid choices save the moment you make them; forms save when you press their **Save** button. Every
change is recorded with your name and the time, and survives a reload, a sign-out and a restart of the
service.

> **Read this before you start.** In this release, the settings on these screens are EOS's **stored
> access policy**, and today they control **who may change that policy** — nothing more yet. The rest
> of EOS — Work Orders, Inventory, Purchasing, Sales and every other area — still decides what people
> can do from the **existing access model**: the *Security Role* shown in the Users directory, and the
> access your onboarding set up. Each area moves onto this stored policy as it is cut over, one at a
> time. **Until an area is cut over, changing a Role here does not change what anyone can do in that
> area.** Nothing in this guide describes a screen you do not have.

## Before you start

### Who may do what

EOS separates *what a Role may do* from *who holds it*, on purpose:

| To do this | You need to hold |
|---|---|
| Create or change a Role, its permissions, Objects or Fields | **Administrator** |
| Give someone a Role, or remove one | **Owner**, **General Manager** or **Administrator** |
| Look at any of these screens | membership of your company's EOS workspace |

Assigning people is a staffing decision; changing what a Role can do is an authority decision. Someone
who may do the first may not automatically do the second.

If you try a change you do not have the Role for, EOS refuses it and says so — for example
`not authorized to perform "editRoleDefinition"`. That is the answer, not a fault.

### You must be set up in EOS first

A person appears on these screens only once they have been **provisioned** into EOS — a Verenward
onboarding step, not something done from a screen. There is no "New user" button, and that is
deliberate. If you sign in and a panel says `this identity is not known to EOS`, your sign-in worked
but your EOS set-up has not been done yet; raise it through the support path below.

### How every screen is laid out

Roles & Permissions and Objects each show two things, one above the other:

1. **Your company's stored configuration** — headed *"this tenant's stored policy"* or *"this tenant's
   stored configuration"*. This is what you change.
2. **Source model** — *"platform reference, not configuration"*, collapsed behind **Show the measured
   model**. It describes what the software does today. It is there to compare against and cannot be
   edited.

The counters at the top of Roles & Permissions (*Can actually do*, *Granted but inert* …) and the
**By role / By object** buttons on Objects belong to that reference model, not to your configuration.

If a panel says **not configured**, this environment has no EOS policy service connected and there is
nothing to change. Contact support.

---

# Part 1 — Roles & Permissions

Open **Administration ▸ Roles & Permissions**. In the **Roles & permissions** panel you will see one
button per Role. A Role marked **· protected** (Administrator, Owner) is part of the platform's own
safety net — see *Warnings* below.

## Step 1 — Choose a Role

Click the Role's button. Its permission grid opens underneath. Until you pick one the panel says
*"Choose a role to configure what it may do."*

## Step 2 — Read the grid

The grid lists **every kind of record** (in EOS these are called *Objects* — Customers, Work Orders,
Parts, Purchase Orders and so on), one per row, with four columns:

| Column | Means the Role may… |
|---|---|
| **Create** | make new records of this kind |
| **Read** | see them |
| **Edit** | change them |
| **Delete** | remove them |

A **—** instead of a checkbox means that action does not exist for that kind of record, so it can never
be granted to anyone. Hover over it and EOS says so: *"No capability governs this verb — it cannot be
granted to anyone."* In this release **Delete is "—" for every Object.**

## Step 3 — Change what the Role may do on an Object

Tick or untick the checkbox. **It saves immediately** — there is no Save button for the grid. The grid
re-reads itself from EOS a moment later; what you see after that is what is stored.

## Step 4 — Go down to individual fields

Click **▸** next to an Object's name. Its fields open beneath it, each with its own Create / Read / Edit
/ Delete cells.

A field cell is not a checkbox. It is a choice of three:

| Choose | Which means |
|---|---|
| **Inherit** | no opinion — the field follows whatever the Object row says |
| **Allow** | allow this field explicitly |
| **Deny** | deny this field explicitly |

Next to the choice, EOS shows what that adds up to:

| You see | It means |
|---|---|
| **Inherited · Allow** | no setting on this field; the Object allows it |
| **Inherited · Deny** | no setting on this field; the Object denies it |
| **Allow** | you allowed this field explicitly |
| **Deny** | you denied this field explicitly |

The difference between *Inherited · Deny* and *Deny* matters. An inherited answer changes when you change
the Object row. An explicit Deny stays denied whatever you later do to the Object.

Like the grid, a field choice **saves immediately**. Choosing **Inherit** does not store a "no" — it
removes your setting, so the field goes back to following the Object.

### Allow · blocked by object

A field can never open up an Object the Role cannot use. If you **Allow** a field but the Object row
itself denies that action, the cell reads **Allow · blocked by object**: your setting is kept, but it
grants nothing until the Object row allows the action too. EOS shows this rather than hiding it, so you
can see why a field is still out of reach.

## Step 5 — Create a Role

1. Click **Create a role**.
2. **Key** — the Role's permanent internal name, for example `regionalManager`. It must start with a
   lower-case letter and contain only letters, digits or underscore. **It cannot be changed later.**
3. **Name** — what people will see, for example *Regional Manager*.
4. **Description** — optional, what the Role is for.
5. Click **Create role**.

The new Role starts with no permissions. Give it permissions in the grid (Steps 3 and 4), then give it
to people (Part 3).

You cannot create a Role with the key `admin` or `owner`; those belong to the platform.

## Step 6 — Rename or re-describe a Role

1. Choose the Role, then click **Edit role details**.
2. Change **Name** and/or **Description**.
3. Click **Save role** — or **Cancel** to leave it unchanged.

The form tells you: *"The key … is identity and cannot change."* That is why there is no Key box.

---

# Part 2 — Objects and Fields

Open **Administration ▸ Objects**. The **Objects** panel lists every kind of record with its **Key**,
**Origin** and whether it is **Deletable**.

## Rename an Object

1. Click **▸** next to the Object.
2. Click **Edit object details**.
3. Change **Label**, **Plural label** and/or **Description**.
4. Click **Save object**.

That is all an Object's settings you can change. The form says why: *"What the object is CALLED is
yours. Its key …, its origin and whether it supports Delete are not."* Renaming changes what EOS calls
the Object on this screen; it does not change the data.

## Look at an Object's fields

Expand the Object. Its fields are listed with **Field**, **Key**, **Type**, **Origin**, **Required**,
**Sensitivity** and **Lifecycle**.

- **SYSTEM** fields belong to EOS. They show **protected** and have no Edit button. Hover and EOS says
  *"A system field's definition is protected."* You still decide who may Create / Read / Edit them —
  that is done in Roles & Permissions, Step 4.
- **CUSTOM** fields are yours. They have an **Edit** button.

## Add a custom field

In the expanded Object, use **Add a custom field**:

1. **Key** — permanent internal name, for example `loyaltyTier`. Starts with a lower-case letter;
   letters, digits or underscore only.
2. **Label** — what people see, for example *Loyalty Tier*.
3. **Type** — STRING, TEXT, NUMBER, BOOLEAN, DATE, TIMESTAMP, ENUM, ENUM_SET, REFERENCE, ADDRESS or
   MONEY.
   - **ENUM** and **ENUM_SET** need **Allowed values (comma separated)**, for example
     `GOLD, SILVER, BRONZE`. An ENUM with no values is refused.
   - **REFERENCE** needs **References object key** — the key of the Object it points at, for example
     `account`.
4. **Sensitivity** — NORMAL, INTERNAL, CONFIDENTIAL or RESTRICTED.
5. Tick **Required**, **Searchable**, **Sortable**, **Reportable** as needed.
6. **Description** — optional.
7. Click **Create field**.

**Key and Type cannot be changed after the field is created.** Choose them carefully.

## Change a custom field

1. Click **Edit** on the field's row.
2. Change any of **Label**, **Description**, **Sensitivity**, **Lifecycle**, **Required**,
   **Searchable**, **Sortable**, **Reportable**.
3. Click **Save field**.

The form says: *"The key … and the type … are not editable."* There is no box for either.

**Retiring a field.** Set **Lifecycle** to **RETIRED** and save. EOS has no way to delete a field —
retiring is how you take one out of use.

---

# Part 3 — Giving people Roles

Open **Administration ▸ Users**. The page has two parts, and they are different things:

| Part of the page | What it is |
|---|---|
| **The Users directory** (the table at the top) | Employee profiles. Its **Security Role** column is the *existing* access role (admin, dispatcher, technician …) — the one that still controls day-to-day access in the areas not yet cut over. |
| **Stored role assignments · policy store** (the panel below) | EOS Role assignments — what this guide is about. |

Changing one does not change the other.

## Give someone a Role

1. In **Stored role assignments**, click the person's button under **Select a principal**. If they
   have no display name, the button shows their sign-in identifier.
2. Their current Roles appear: **Role**, **Scope**, **Status**.
3. Under **Add role**, open **Choose a role…** and pick the Role. **The list only offers Roles the
   person does not already hold** — a Role they have cannot be given twice.
4. Click **Add role**.

Roles **add up**: a person with two Roles may do everything either Role allows. There is no "primary"
Role. Roles given from this panel apply company-wide (**Scope** *global*).

## Take a Role away

Click **Remove** on the row with **Status** *active*.

The row stays in the list with **Status** *disabled*: EOS keeps the history of who held what. To give
the Role back later, add it again — EOS creates a new assignment; the old one stays as history.

---

# Part 4 — Workflows

**Administration ▸ Workflows** shows the business processes EOS knows about and which Roles act in
them. Under **Stored workflow definitions** you can open each workflow's versions and read its steps
and actions.

This screen is **read-only**. All five workflows are shown as **Draft**, and there is nothing to start,
publish or change from here. The processes themselves — Work Orders, reorder requests, sales — keep
running exactly as they do today; these Draft definitions describe them and do not route any work.

---

## What EOS does automatically

- **Every change is recorded** — who made it, when, what it was before and after. A save that changes
  nothing (for example, pressing Save without editing) is not recorded as a change.
- **Nothing is lost on reload or restart.** Your settings are stored centrally, not in your browser.
- **Access is recalculated for the people affected.** When you change a Role, EOS marks everyone holding
  it as needing their access re-read.
- **A field setting can never open a closed Object** (*Allow · blocked by object*).
- **The last administrator is protected.** EOS will not let the company end up with nobody able to
  administer it.

## Warnings and exceptions

What you might see, and what it means:

| Message | Meaning |
|---|---|
| `not authorized to perform "…"` | your Role does not allow this change — see *Who may do what* |
| `this is the last active administering assignment -- revoking it would leave the tenant unadministrable` | you tried to remove the only remaining Administrator or Owner assignment. Give the Role to someone else first |
| `"admin" is a protected system role key` (or `"owner"`) | those keys belong to the platform |
| `role key must start with a lower-case letter and contain only letters, digits or underscore` | fix the Key — the same rule applies to field keys |
| `an ENUM field needs allowed values -- an enum of nothing can hold nothing` | add **Allowed values** |
| `a REFERENCE field must say which object it points at` | fill in **References object key** |
| `a SYSTEM field's definition is protected …` | SYSTEM fields cannot be edited; set who may use them in Roles & Permissions instead |
| `nothing to update` | the save named nothing that can change |
| `that principal is not an active member of this tenant` | that person is not set up in your company's EOS workspace |
| `this identity is not known to EOS` | you are signed in but not yet provisioned in EOS |

**On a phone or small tablet** these screens work, but the permission grid is wider than the screen:
**swipe the grid itself sideways** to reach the Read, Edit and Delete columns. After a change, the grid
scrolls back to the left.

**Saving Role details closes any Object you had expanded** in the grid. Expand it again to carry on.

**There is no delete** for Roles, custom fields or Objects in this release. A Role you no longer need
can be left with no permissions and no holders — it then grants nothing. A custom field can be
**RETIRED**.

## If something looks wrong

**A person can still (or still cannot) do something in Work Orders, Inventory, Purchasing or another
area after you changed their Role here.** In this release that is expected — see *Read this before you
start*. Those areas still follow the existing access model. Do not try to force it by changing the
Security Role or anything else yourself; raise it through the support path.

**A setting does not look the way you left it.** Reload the page. What appears after a reload is what
EOS has stored. If it still looks wrong, note the Role, Object, field and what you expected, and raise it.

**A field is Allowed but still out of reach.** Check its Object row — you will see
**Allow · blocked by object**. Allow the action on the Object row too.

**Never** try to change access by sharing a login, asking someone to act on your behalf, or working
around a refusal.

## Support and escalation

1. Your **Taylor EOS Administrator** first — most of this is configuration.
2. Anything the administrator cannot resolve goes to **Verenward** through the agreed support path.

*(The formal support and escalation procedure — severity, response commitments, the bug-versus-request
boundary — is still being established under Customer 1 gate `C1-SUPPORT-01`. Until it is agreed, use the
route your administrator gives you.)*

## Administrator notes

**Self-service for the Taylor EOS Administrator:** creating and renaming Roles; setting Object and field
permissions; renaming Objects; creating, changing and retiring custom fields; giving and removing Roles.

**Verenward responsibilities, not screens:**

- setting a person up in EOS (provisioning) so they appear under **Select a principal**;
- the protected Administrator and Owner Roles, and the last-administrator safeguard;
- moving each business area onto the stored policy (cut-over), and publishing any workflow;
- deleting Roles, fields or Objects — not available in this release.

## Changes in this release

- **New:** EOS's stored access policy — Roles & Permissions, Objects and the **Stored role
  assignments** panel on Users are now editable and saved centrally.
- **New:** field-level permissions with **Inherit / Allow / Deny**, and the **Allow · blocked by
  object** indicator.
- **New:** custom Roles and custom fields.
- **Not yet in effect:** the stored policy does not yet decide access in Work Orders, Inventory,
  Purchasing, Sales or any other business area; those follow the existing access model until each is
  cut over.
- **Known limitations:** no delete for Roles, fields or Objects; Workflows are read-only and all five
  are Draft; on a phone the grid returns to its left edge after each change.

## Verification receipt

- Training checked against deployed release/SHA: frontend `0c733704` (`/version.json` → `0c73370`) and
  EOS API `44f423c9` (Render `dep-dah7vr3bc2fs73fivgqg`). The policy code these screens use is unchanged
  since the technical acceptance, whose record is `docs/architecture/eos-real-nonprod-activation.md`.
- Workflow exercised/visually verified: every step in Parts 1–3 was performed through the deployed UI
  during browser acceptance on 2026-09-10 at 375 / 1024 / 1440 px — Owner-driven input, Claude-measured
  requests, responses and reloads (acceptance record §15). Labels, button text, messages and the
  who-may-do-what rules were checked against the source at `0c733704`. The claim that the stored policy
  does not yet govern business areas was checked in source: nothing outside the Administration screens
  and the EOS API reads it.
- Screenshots current where used: not applicable — no screenshots.
- Known sandbox-only or future behavior present in guide: `NO` — undeployed items (business-area
  cut-over, workflow publishing, deletion, the pending workspace-label change) are named only as not
  available.
- Training status: `COMPLETE`
