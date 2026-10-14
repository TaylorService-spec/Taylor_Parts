# Financial Policy — EOS User Guide

**Audience:** Financial Policy Preparers (for example a Controller), the Owner, and Taylor EOS Administrators
**Applies to:** Administration › Financial Policy
**Training represents:** `59c68b0c` (PR #2086, on the PostgreSQL foundation from PR #2085)
**Effective date:** 2026-10-14
**Environment:** nonproduction (sandbox training). Production activation needs a separate Owner decision.
**Owner:** Verenward product training

## What this guide helps you do

Each operating company (for example Taylor, or Ventana) has its own **Financial Policy**: the inventory costing and
cost-of-goods rules its accounting team has chosen. This guide shows how to prepare a policy, submit it for approval,
approve or reject it, and read its history.

EOS never chooses a method for you. Until a company's policy is activated, EOS applies **no** costing method for that
company, and the page says so: *"Not configured: no policy is in effect."*

## Before you start

What you can do depends on your Security Roles, and on which operating companies they cover.

| You are | You can |
|---|---|
| **Financial Policy Preparer** (assigned per company) | View the policy and prepare, edit and submit drafts, for the companies your assignment covers |
| **Owner** | View the policy, approve or reject submitted versions, and activate approved versions, for every company |
| **Taylor EOS Administrator** | Same as the Owner (view, approve or reject, activate), for every company |
| Anyone else | Nothing. The page is not in your navigation, and opening it directly shows *"Financial Policy isn't available to your role"*. |

- **Separate duties.** Preparing and approving are deliberately separate. The Owner and Administrator cannot prepare
  drafts. A preparer cannot approve, reject or activate.
- **Company access.** A preparer's access follows their assignment. Someone assigned *Taylor only* sees only Taylor;
  someone assigned *Taylor and Ventana* sees both. Other companies are never listed.

## Normal workflow

### 1. Open the page and choose a company

1. Go to **Administration › Financial Policy**. It is listed under *System & Integrations*.
2. In **Operating Company**, choose the company. Only the companies your access covers are listed.
3. Under the company list, EOS shows what you may do: **View policy**, **Prepare drafts**, **Approve or reject**
   and **Activate**. Anything you cannot do is marked *not available*, with the reason.
4. **Policy Summary** shows:
   - the policy **In Effect**;
   - any version **Scheduled** for a future date;
   - any version **In Progress**.

### 2. Prepare a draft (Preparer)

1. In **Prepare a New Draft**, choose a value for each field. The fields are:
   - **Interchangeable Inventory Costing:** for example Weighted average or FIFO.
   - **Serialized Inventory Costing:** Specific identification, Weighted average or FIFO.
   - **COGS Recognition Event:** when cost leaves inventory. An option EOS cannot support yet is shown greyed out,
     with the reason.
   - **Inbound Freight** and **Other Landed Costs:** *Excluded from inventory cost*.
2. Optionally write a **Note**. It is kept in the audit trail.
3. Select **Create Draft**. The version appears as *In Progress: Draft*.
4. To change it, adjust the fields and select **Save Draft**. Every save is recorded.

A new draft starts from the policy in effect, if there is one. Saving a draft changes nothing about how EOS works.

### 3. Submit for approval (Preparer)

1. When the draft is complete, select **Submit for Approval**.
2. The version becomes *Submitted for Approval*. Its content is now frozen and nobody can edit it.

### 4. Approve or reject (Owner or Administrator)

1. Choose the company. **Decide Version N** shows the submitted content.
2. To approve: optionally add an **Approval Note**, then select **Approve**.
3. To reject: enter a **Rejection Reason** (required), then select **Reject**. A rejected version is closed for
   good, and a new draft can then be prepared.

### 5. Activate (Owner or Administrator)

1. For an approved version, choose the **Effective Date**. It cannot be earlier than the company's business date
   shown on the page.
2. Select **Activate**.
   - If the date is today, the policy is **In Effect**.
   - If the date is in the future, it is **Scheduled** and takes effect on that date.
3. The previous policy stays in effect until the new one's effective date.

> **Activation has a lasting effect: it locks the version.** Activation in production needs a separate Owner decision.

### 6. Read the history

- **Version History** lists every version, newest first, with:
  - who prepared and submitted it, and when;
  - the decision (approved or rejected), by whom, and the reason;
  - activation and effective date.
- **Audit Trail** lists every change, with who made it, when, and the stated reason or note.
- Versions are never deleted.

## What EOS does automatically

- **Checks your authority on the server** for every action. The buttons only reflect what the server will allow.
- **Keeps companies separate.** Each company has its own versions and history. Nothing is shared or combined, and
  there is no "all companies" policy.
- **Locks activated versions.** An active or replaced version can never be edited. A change is always a new draft
  that goes through the same steps.
- **Enforces separate duties.** Whoever prepared, edited or submitted a version cannot approve, reject or activate
  that same version, even if they also hold the Owner Role.
- **Records everything** in the audit trail.
- **Shows the active policy in Financials.** The Financials governance panel shows the active policy per company and
  links back to this page.

## Warnings and exceptions

These are the messages you may see, and what they mean.

| You see | Meaning | What to do |
|---|---|---|
| *Your Security Roles do not include this Financial Policy action* | Your Roles don't allow this action | Ask an Administrator if you should have it |
| *…not held for operating company…* | That company is outside your assignment | Use a company you are assigned to, or ask an Administrator |
| *You prepared, edited or submitted this version, so someone else must approve, reject or activate it* | Separate duties | Another authorized person decides |
| A version is already in progress | Each company can have only one version in progress | Finish it: submit and decide it |
| *Not submitted* | Only a submitted version can be approved or rejected | Submit it first |
| *Save your changes before submitting* | The editor has unsaved changes | Select **Save Draft** first |
| A replay conflict | The same request was re-sent with a different note | Refresh the page and try again |

### Known limitations

These are current, deliberate limitations. Plan around them.

- **No withdraw or cancel.** A draft or submitted version can only be closed by **Reject**. An **approved** version
  stays *In Progress* until it is activated, and no new draft can start for that company meanwhile. So approve only a
  version you intend to activate.
- **Correcting a scheduled version.** A correction must be dated after the scheduled version. A scheduled version
  cannot be cancelled.
- **No conversion step yet.** Changing a method after a policy is active (for example Weighted average to FIFO) goes
  through the same draft-and-approve steps. The separate impact-assessment and conversion step is not built yet, so
  plan such changes with the accounting team before preparing them.

## If something looks wrong

1. Check that the right company is selected.
2. Read the reason shown next to the unavailable action.
3. Ask a Taylor EOS Administrator to check your access:
   - go to **Administration › Employees & Users**, open the employee, and look at their Security Roles and company
     scopes;
   - or use **Effective Access**, which shows Financial Policy as *SCOPED[company]* for preparers.
4. If it still looks wrong, contact Verenward support.

Do not ask anyone to change the database or grant the capability directly to a person. Direct grants of Financial
Policy access are refused by design.

## Administrator notes

- **Making someone a preparer.** Assign the **Financial Policy Preparer** Security Role to the employee with
  **Company** scope, once per company: one assignment for Taylor, another for Ventana. Do not use *All (Global)*
  unless the person should prepare for every company.
- **Use the preview.** Review the grant-impact preview before every change.
- **Owner approval authority.** It comes from the Owner Role (read, approve and activate). The Administrator has the
  same authority by Administrator standing. Neither can prepare.
- **Direct grants are refused.** Financial Policy *read* and *prepare* cannot be granted directly to a person; EOS
  refuses it. Any such grant left over from before is shown as *Not effective — role assignment only* and confers
  nothing.
- **Finance Configuration stays separate.** The **Finance Configuration** section further down the page (accounting
  destinations, payment terms) is separate from the Financial Policy and keeps its own access rules.

## Changes in this release

- New: **Administration › Financial Policy** for preparing, approving and activating per-company policies.
- New Security Role: **Financial Policy Preparer**, assigned per operating company.
- The Financials governance panel now shows the actual policy state per company, instead of a fixed "Not configured".
- The grant matrix shows prohibited direct grants as *Not effective*.

## Verification receipt

- **Training checked against deployed release:** `59c68b0c` (nonprod, 2026-10-14).
- **Workflow exercised in the deployed nonprod app with governed persona sessions:**
  - Finance Controller (Taylor-only preparer): drafted, edited and submitted for Taylor; Ventana refused.
  - Bai (Taylor and Ventana preparer): drafted and submitted for Ventana.
  - The Owner rejected the Taylor version; the Administrator rejected the Ventana version.
  - Unauthorized roles: refused in navigation, by direct URL, and by the API.
  - All drafts used clearly marked SYNTHETIC test values and were rejected.
- **Not exercised in nonprod (deliberately):** approval and activation. Approval would leave the company with an
  approved, unactivated version, and activation needs a separate Owner decision. Both are covered by automated
  PostgreSQL tests.
- **Screenshots current where used:** not embedded in this guide; UAT screenshots are kept with the Phase 3 evidence.
- **Known sandbox-only or future behavior present in guide:** NO (limitations are labelled as current limitations).
