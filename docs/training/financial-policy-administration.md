# Financial Policy — EOS User Guide

**Audience:** Financial Policy Preparers (for example a Controller), the Owner, and Taylor EOS Administrators
**Applies to:** Administration › Financial Policy
**Training represents:** `6fc7a963` (PR #2089 company assignment, on PR #2088 withdraw / cancel, PR #2086 screen and PR #2085 foundation)
**Effective date:** 2026-10-14
**Environment:** nonproduction (sandbox training). Production activation needs a separate Owner decision.
**Owner:** Verenward product training

## What this guide helps you do

Each operating company (for example Taylor, or Ventana) has its own **Financial Policy**: the inventory costing and
cost-of-goods rules its accounting team has chosen. This guide shows how to prepare a policy, submit it for approval,
approve or reject it, activate it, withdraw or cancel a version that should not go ahead, and read its history.

EOS never chooses a method for you. Until a company's policy is in effect, EOS applies **no** costing method for that
company, and the page says so: *"Not configured: no policy is in effect."*

## Before you start

What you can do depends on two things, and you need **both**:

1. **Your Security Roles**, which decide which actions you may take; and
2. **Your company assignment**, which decides which operating companies you may take them in.

A Role with no company assignment reaches **no** company. EOS never assumes "all companies".

| You are | Company assignment | You can |
|---|---|---|
| **Financial Policy Preparer** | Assigned per company (for example Taylor only, or Taylor and Ventana) | View the policy; prepare, edit, submit and withdraw your own drafts, in your assigned companies |
| **Owner** | **Financial Policy Reviewer**, assigned per company | View the policy; approve, reject, activate, and cancel approvals or scheduled versions, in your assigned companies |
| **Taylor EOS Administrator** | None by default | **Nothing on this page.** Administering EOS does not give access to a company's accounting policy |
| Anyone else | — | Nothing. The page is not in your navigation, and opening it directly shows *"Financial Policy isn't available to your role"*. |

- **Separate duties.** Preparing and deciding are deliberately separate. The Owner cannot prepare drafts. A preparer
  cannot approve, reject, activate or cancel.
- **Company access.** You see only the companies you are assigned to. Someone assigned *Taylor only* sees only Taylor;
  other companies are never listed or named.
- **No company assigned.** If your Roles allow Financial Policy but you have no company assignment, the page says
  *"No active operating company is within your Financial Policy access."* Ask an Administrator to assign you.

## Normal workflow

### 1. Open the page and choose a company

1. Go to **Administration › Financial Policy**. It is listed under *System & Integrations*.
2. In **Operating Company**, choose the company. Only the companies you are assigned to are listed.
3. Under the company list, EOS shows what you may do: **View policy**, **Prepare drafts**, **Approve or reject**,
   **Activate**, **Withdraw your own versions** and **Cancel approvals**. Anything you cannot do is marked
   *not available*, with the reason.
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

### 4. Approve or reject (Owner)

1. Choose the company. **Decide Version N** shows the submitted content.
2. To approve: optionally add an **Approval Note**, then select **Approve**.
3. To reject: enter a **Rejection Reason** (required), then select **Reject**. A rejected version is closed for
   good, and a new draft can then be prepared.

### 5. Activate (Owner)

1. For an approved version, choose the **Effective Date**. It cannot be earlier than the company's business date
   shown on the page.
2. Select **Activate**.
   - If the date is today, the policy is **In Effect**.
   - If the date is in the future, it is **Scheduled** and takes effect on that date.
3. The previous policy stays in effect until the new one's effective date.

> **Activation has a lasting effect: once a version is in effect it is locked.** Activation in production needs a
> separate Owner decision.

### 6. Withdraw a version you prepared (Preparer)

Use this when a draft or a submitted version should not go ahead.

1. Choose the company. For your **Draft** or **Submitted for Approval** version, select **Withdraw**.
2. EOS asks you to confirm and states the consequence. Enter a **Reason** (required, kept in the audit trail), then
   select **Withdraw Version**. **Keep It** closes the confirmation without changing anything.
3. The version becomes *Withdrawn*. It stays in the history and is final.
4. The company is free again: a new draft can be prepared straight away.

Only someone who created, edited or submitted the version can withdraw it, and only in a company they are still
assigned to. An approved version cannot be withdrawn; the Owner cancels it instead.

### 7. Cancel an approval (Owner)

Use this when an approved version should never be activated.

1. Choose the company. For the **Approved** version, select **Cancel Approval**.
2. Enter a **Reason** (required), then select **Cancel Approval** to confirm.
3. The version becomes *Approval Cancelled*. It keeps its approval and note in the history, is final, and will never
   be activated.
4. The company is free again: a new draft can be prepared.

The approver may cancel their own approval. Whoever prepared, edited or submitted the version cannot cancel it.

### 8. Cancel a scheduled version before it takes effect (Owner)

A version activated with a **future** effective date is *Scheduled*: it is not in effect yet. Until that date it can
still be cancelled.

1. Choose the company. Under **Cancel This Scheduled Version** (one panel per scheduled version), select **Cancel Scheduled Version**.
2. Enter a **Reason** (required), then confirm.
3. The version is cancelled and will **never** take effect. The policy in effect stays exactly as it would have
   been without it. The history shows it as *Cancelled before taking effect*, with its activation details kept.

Once a version's effective date has arrived, it is **in effect** and can no longer be cancelled. A change is then a
new draft, submitted, approved and activated.

> **"Activated" is not the same as "in effect".** A scheduled version has been activated, but it does not govern
> anything until its effective date. The page's **In Effect** card always shows the policy actually governing today.

### 9. Read the history

- **Version History** lists every version, newest first, with:
  - who prepared and submitted it, and when;
  - the decision (approved or rejected), by whom, and the reason;
  - activation and effective date;
  - any withdrawal or cancellation, by whom, when, and the reason.
- **Audit Trail** lists every change, with who made it, when, and the stated reason or note.
- Versions are never deleted.

## Owner versus Administrator

| | Owner | Taylor EOS Administrator |
|---|---|---|
| **Business authority over Financial Policy** | Yes: approves, rejects, activates and cancels, but **only in the companies the Owner is assigned to** (Taylor and Ventana today, through the Financial Policy Reviewer Role) | **No.** Administrator standing does not include any company's Financial Policy. Without a company assignment, every read and action is refused on the server, whatever the menu shows |
| **Prepares drafts** | No | No |
| **Administers access** (Roles, assignments, grants) | Through the Owner Role | Yes. This is the Administrator's job |

The Administrator manages **who** has access; the Owner and the preparers exercise it. Giving the Administrator
Financial Policy business authority would itself need an explicit company assignment, decided by the Owner.

## What EOS does automatically

- **Checks your authority on the server** for every action, including your company assignment. The buttons and the
  menu only reflect what the server will allow; hiding or showing them never grants anything.
- **Keeps companies separate.** Each company has its own versions and history. Nothing is shared or combined, and
  there is no "all companies" policy or access.
- **Hides companies you are not assigned to.** An unassigned company and a company that does not exist get the same
  answer, so nobody can find out which companies exist.
- **Locks versions in effect.** A version in effect, or one it replaced, can never be edited or cancelled. A change is
  always a new draft that goes through the same steps.
- **Enforces separate duties.** Whoever prepared, edited or submitted a version cannot approve, reject, activate or
  cancel that same version, even if they also hold the Owner Role.
- **Keeps one version in progress per company.** Withdrawing or cancelling frees the company for a new draft.
- **Records everything** in the audit trail.
- **Shows the policy in effect in Financials.** The Financials governance panel shows the policy per company and
  links back to this page.

## Warnings and exceptions

These are the messages you may see, and what they mean.

| You see | Meaning | What to do |
|---|---|---|
| *Your Security Roles do not include this Financial Policy action* | Your Roles don't allow this action | Ask an Administrator if you should have it |
| *Your Financial Policy access does not cover this operating company* | You are not assigned to that company | Use a company you are assigned to, or ask an Administrator to assign you |
| *No active operating company is within your Financial Policy access* | You have no company assignment | Ask an Administrator to assign you |
| *You prepared, edited or submitted this version, so someone else must approve, reject, activate or cancel it* | Separate duties | Another authorized person decides |
| *Only someone who prepared, edited or submitted this version can withdraw it* | It is not your version | Ask its preparer, or the Owner if it is approved |
| *Only a draft or a version submitted for approval can be withdrawn…* | The version is approved, final or in effect | The Owner can cancel an approved version |
| *Only an approved version, or one scheduled but not yet in effect, can be cancelled* | Nothing to cancel | — |
| *An activated version is locked and is never edited…* | The version is in effect | Prepare a new draft |
| *A reason is required* | Withdrawing and cancelling always need a reason | Enter a reason |
| A version is already in progress | Each company can have only one version in progress | Finish it, or withdraw / cancel it |
| A replay conflict | The same request was re-sent with a different note | Refresh the page and try again |

### Known limitations

These are current, deliberate limitations. Plan around them.

- **No conversion step yet.** Changing a method after a policy is in effect (for example Weighted average to FIFO)
  goes through the same draft-and-approve steps. The separate impact-assessment and conversion step is not built yet,
  so plan such changes with the accounting team before preparing them.
- **New companies are never reached automatically.** When an operating company is added, nobody can see or decide
  its policy until they are explicitly assigned to it.

## If something looks wrong

1. Check that the right company is selected.
2. Read the reason shown next to the unavailable action.
3. Ask a Taylor EOS Administrator to check your access:
   - go to **Administration › Employees & Users**, open the employee, and look at their Security Roles and company
     scopes;
   - or use **Effective Access**, which shows Financial Policy as *SCOPED[company]*.
4. If it still looks wrong, contact Verenward support.

Do not ask anyone to change the database or grant the capability directly to a person. Direct grants of Financial
Policy access are refused by design.

## Administrator notes

- **Every Financial Policy user needs a company assignment.** Assign Roles with **Company** scope, once per company:
  one assignment for Taylor, another for Ventana. A Role assigned *All (Global)* reaches **no** company on this page
  by itself.
- **Making someone a preparer.** Assign the **Financial Policy Preparer** Security Role with Company scope for each
  company they prepare for.
- **The Owner's company access.** The Owner Role gives the Owner the authority to decide; the **Financial Policy
  Reviewer** Role (view only), assigned with Company scope, says *in which companies*. Today the Owner is assigned to
  Taylor and Ventana. Assigning the Owner to a new company is a separate, deliberate step.
- **The Reviewer Role grants only viewing.** It never adds approval, activation, cancellation or preparation; those
  come only from the Owner Role or the Preparer Role.
- **The Administrator has no Financial Policy business access** unless explicitly assigned to a company, which is an
  Owner decision.
- **Use the preview.** Review the grant-impact preview before every change.
- **Direct grants are refused.** Financial Policy *view* and *prepare* cannot be granted directly to a person; EOS
  refuses it. Any such grant left over from before is shown as *Not effective — role assignment only* and confers
  nothing.
- **Finance Configuration stays separate.** The **Finance Configuration** section further down the page (accounting
  destinations, payment terms) is separate from the Financial Policy and keeps its own access rules.

## Changes in this release

- New: **Withdraw** your own draft or submitted version, with a required reason.
- New: **Cancel Approval** of an approved version, including your own approval, with a required reason.
- New: **Cancel Scheduled Version**: a version activated for a future date can be cancelled until it takes effect.
- Withdrawing or cancelling frees the company for a new draft. Nothing is deleted; the history keeps every step.
- Changed: **company assignment is required** for everyone. The Owner reaches only assigned companies (Taylor and
  Ventana, through the new **Financial Policy Reviewer** Role); the Administrator no longer has Financial Policy
  business access by default.
- Changed: a company you are not assigned to is answered exactly like one that does not exist.
- Earlier in this release: **Administration › Financial Policy**, the **Financial Policy Preparer** Role, the
  Financials governance panel showing the real policy state, and *Not effective* labels for prohibited direct grants.

## Verification receipt

- **Training checked against deployed release:** `6fc7a963` (nonprod, Render live 2026-10-14 16:47 UTC, 99 migrations).
- **Lifecycle exercised in the deployed nonprod app with governed persona sessions (release `3b234832`):**
  - Finance Controller (Taylor only) withdrew a Taylor draft and a submitted Taylor version, each with a reason.
  - Bai (Taylor and Ventana) prepared and submitted a Ventana version; the Administrator (then still authorized)
    approved it and cancelled its own approval.
  - The Owner approved a Taylor version, activated it for a future date (*Scheduled*, never in effect) and cancelled
    it before it took effect.
  - Every withdrawal and cancellation freed the company for a new draft; the history and audit trail kept every step.
- **Company assignment exercised (release `6fc7a963`):**
  - Owner: Taylor and Ventana only; approved and then cancelled a synthetic Taylor version without activating it.
  - Administrator (no assignment): no company listed; every read and action refused in both companies.
  - Finance Controller: Taylor only. Bai: Taylor and Ventana. Neither can approve, activate, reject or cancel.
  - Dispatcher: refused.
  - Unknown company names answered exactly like an unassigned real company.
- **End state:** no company has a policy in effect or scheduled; every test version used SYNTHETIC values and is
  withdrawn, rejected or cancelled.
- **Screenshots current where used:** not embedded in this guide; acceptance evidence is kept with the release record.
- **Known sandbox-only or future behavior present in guide:** NO (limitations are labelled as current limitations).
