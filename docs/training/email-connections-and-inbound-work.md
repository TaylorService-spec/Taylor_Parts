# Email Connections and Inbound Work — EOS User Guide

**Audience:** Taylor EOS Administrator (Part 1) · Service coordinator / dispatcher working the inbound queue (Part 2)
**Applies to:** `Administration ▸ Email & Communications`, `Service ▸ Inbound Work`
**Training represents:** `de90d6b0`
**Effective date:** 2026-09-06
**Environment:** sandbox training — `platform-sandbox`
**Owner:** Verenward product training

## What this guide helps you do

Work that arrives by email — a warranty call from Taylor Corporate, a service request from a vendor, a
customer writing to the service mailbox — becomes a Work Order **without anyone retyping it**.

EOS reads the message, proposes a customer, a site, a unit and a problem, and puts it in a queue. A
coordinator checks that reading, corrects anything wrong, and presses **Accept Job**. One Work Order is
created, carrying what the message actually said.

Part 1 is the administrator's job: connecting a mailbox and deciding how mail is classified. Part 2 is
the coordinator's job: deciding what happens to each message that arrives.

> **Read this before you start.** In the environment this guide represents, mail is **not** yet being
> collected: no Microsoft 365 or Google Workspace account has been connected. Part 1 explains what you
> can configure today and names, plainly, the four buttons that do nothing yet and why. Part 2 works
> completely against any request already in the queue. Nothing in this guide describes a screen you do
> not have.

## Before you start

EOS access is by **Role**, and the two halves of this workflow are deliberately separate people:

| You need | To do |
|---|---|
| **Email Intake Administrator** | Part 1 — connections, mailboxes, routing rules |
| **Service Inbound Work Reviewer** | Part 2 — read the queue, Accept, Decline, Attach |

Holding one does **not** give you the other, and that is on purpose. Someone who works the queue all day
cannot repoint the company's inbound mail, and the administrator who connects a mailbox cannot accept the
work that arrives in it. If you need both, you hold both — as two Roles, assigned and audited.

If a screen tells you a section is not part of your role, that is the answer, not a fault. Ask your
Taylor EOS Administrator; do not look for a way around it.

---

# Part 1 — Administrator: connecting mail

Go to **Administration ▸ Email & Communications**. It has seven tabs: Overview, Connections, Mailboxes,
Routing Rules, Processing, Processing History, Exceptions.

Three ideas, in the order you set them up:

1. a **connection** is the Microsoft 365 or Google Workspace account EOS reads mail through;
2. a **mailbox** is one address inside it — Service, Warranty, Parts. One connection commonly has several;
3. a **routing rule** decides how a message arriving in a mailbox is classified.

## Step 1 — Add a connection

1. Open the **Connections** tab.
2. Open **+ Add a connection**.
3. Fill in:
   - **Connection name** — what your team will call it, e.g. `Taylor Service 365`.
   - **Provider** — Microsoft 365 / Outlook, or Google Workspace / Gmail.
   - **Tenant id** (Microsoft) or **Workspace domain** (Google).
   - **Connected account** — the mailbox account EOS will read through.
4. Press **Save connection**.

The connection appears as a card showing its name, provider and account, and two status answers: whether
it is **authorized**, and whether it is **healthy**. Beneath, when it was authorized and when mail last
arrived.

**EOS never stores a mailbox password, and never stores an OAuth token as ordinary configuration.** There
is no field on this screen to type one into, and the server refuses any field that looks like credential
material. Authorization happens with the provider; what comes back is held in the platform's secret
store. This screen only ever tells you whether a credential exists.

> **Not available in this environment: `Connect`.** Authorizing a connection needs a Microsoft 365 or
> Google Workspace *application* registered against this EOS environment, and none is. The card says
> *"No OAuth client is configured in this environment"* and the button stays disabled. `Test connection`
> is unavailable for the same reason. Registering that application is a step outside EOS; your
> administrator or Verenward arranges it. Until then **no mail is collected** — everything below is still
> worth configuring, and none of it will receive anything yet.

## Step 2 — Add a mailbox

Open the **Mailboxes** tab.

If no connection exists yet, the screen says so and offers **Add a connection first** rather than an
empty picker — a mailbox has to belong to something.

Otherwise open **+ Add a mailbox** and fill in:

- **Connection** — which account this address lives in.
- **Display name** — `Warranty`, `Service`, `Parts`. This is the name your coordinators will see.
- **Email address** — the actual address.
- **Purpose** — Service, Warranty, Parts or Other.
- **Default queue** and **Operating company** — optional; used when a routing rule does not set them.

Press **Save mailbox**.

Each mailbox row shows whether EOS could **read** it, and when it was last checked or last received
something.

> **Not available in this environment: `Check now`.** Collecting mail on demand needs the same provider
> authorization as `Connect`.

## Step 3 — Routing Rules

Open the **Routing Rules** tab to see how mail is classified. Rules are evaluated **in order, first match
wins**, and each reads as a sentence:

> **When** `mailbox is Warranty and sender domain is corporate.example`
> **Then** `classify as Warranty, send to Service, queue WARRANTY_REVIEW, priority 2, hold for review`

**A message no rule matches is still taken in.** It is classified as Service and flagged for review —
never silently classified as something it might not be.

> **Known limitation.** Routing rules are **read-only on this screen** in this release. Creating or
> changing one is a configuration request to Verenward. You can see exactly what is in force; you cannot
> yet edit it here.

## The other tabs

- **Overview** — how many requests arrived and what state they are in. Every number is counted from real
  records in this environment; an environment with no mail shows zeroes.
- **Processing** — explains that base EOS reads inbound messages itself. No add-on is required, and none
  is installed.
- **Processing History** — how many requests were accepted, declined or attached.
- **Exceptions** — see below.

## Exceptions: nothing is ever discarded

A message that failed processing, arrived in a mailbox EOS does not recognise, or was delivered twice is
**kept**, with the reason. It is never thrown away.

Delivery problems appear here leading with what to do about them:

- **Retrying on its own** — EOS will try again; no action needed.
- **Needs attention** — retries are exhausted, or a person must act. The sentence beside it says what,
  e.g. *"The connected account cannot read that mailbox. Grant it access, then retry."*

> **Not available in this environment: `Retry now`.** Same provider authorization.

---

# Part 2 — Coordinator: working the Inbound Work queue

Go to **Service ▸ Inbound Work**.

The counts across the top are Awaiting decision, Needs review, Accepted, Declined. Below is the queue:
when it arrived, who from, the subject, the type and its status.

**Needs review** means EOS wants a person to look harder — usually because it could not identify the
customer, or the message was missing something it expected.

Click a row to open it.

## Reading the request

The screen has two panes, side by side (stacked on a phone).

**Original message** — exactly what arrived, and never editable: who it is from, who it was addressed to,
when it arrived, the subject, which mailbox it landed in, and the message body. Under it,
**Attachments**, each marked so you know what you are looking at:

- **Download** — EOS holds the file. Press to save it.
- **Not retrieved yet** — the sender listed it; EOS has not collected it.
- **Could not be retrieved** — EOS tried and failed. The message itself still arrived; an administrator
  can retry it from Exceptions.

If there are replies on the thread, they appear beneath as **Later messages on this thread**.

**EOS work interpretation** — what EOS made of it, and the part you can change:

- **Request type**, **Priority**, **Problem** — pre-filled, all editable.
- **Customer** — EOS suggests one where it recognised the sender or a unit. Press **Change** to pick a
  different one. Changing the customer clears the site and unit chosen under the previous one, so a stale
  selection cannot be submitted.
- **Location** and **Equipment** — the same pickers the Work Order wizard uses.
- **Model**, **Serial**, **Warranty / authorization**, **External reference** — read out of the message.
- **Routing** — which rule matched, by name, and the queue it set.

Orange labels near the top are what EOS could **not** find — *No serial number found*, *No warranty or
reference number found*. They are information, not errors. Fill in what you can.

## Accept, Decline, or Attach

**Accept Job** creates the Work Order. You must have chosen a **customer** and a **location** first; the
unit is optional. EOS creates one Work Order from the values you confirmed and takes you straight to it.

**Decline Job** turns the request away. Choose a **Decline reason** — Outside service area, Unsupported
equipment, No capacity, Duplicate request, Customer account issue, Invalid request, Other — and add a
note if it helps. The message is kept with your reason; no Work Order is created.

**Attach to Existing Work** files the request against a job you already have. Enter the **Work Order id**
(copy it from the Work Order itself) and press the button. No second Work Order is created.

If an action is not available to you, the screen says so — *"Accepting a job is not part of your role."*

## What EOS does automatically

Understand these; do not try to reproduce them by hand.

- **One message becomes one request.** If the provider delivers the same message twice, EOS recognises it
  and does not queue it again.
- **Pressing Accept twice gives you the same Work Order**, not two. So does two people clicking at once.
- **A reply on a thread joins the request it belongs to.** If that request was already accepted, the
  reply is preserved on it and creates **no** second Work Order.
- **Accepting never edits customer, site, contact or equipment records.** An inbound email is not
  authority to change mastered data.
- **Every decision is recorded** — who, when, and against which message. That trail is why a Work Order
  can always be traced back to the email that caused it.
- **EOS only reads.** Nothing is sent, replied to, marked, moved or deleted in the provider's mailbox.
  EOS does not send email at all in this release.

## Warnings and exceptions

| What you see | What it means | What to do |
|---|---|---|
| *Needs review* | EOS could not identify the customer, or the message was missing information | Open it and fill in what is missing |
| *No rule matched — review required* | No routing rule applied, so it was treated as Service | Choose the right type yourself |
| *Reply matched more than one open request* | A reply could belong to two open requests | Read the thread and decide which; tell your administrator it happened |
| *Processing failed* | EOS could not read the message | It is kept in full — work it by hand |
| *Could not be retrieved* on an attachment | The file did not come through | The message still arrived; ask your administrator to retry it from Exceptions |
| *Showing the most recent requests only* | The queue is long | Work the oldest first; nothing is lost |
| An action is missing, or a section says it is not part of your role | You do not hold that Role | Ask your Taylor EOS Administrator. Do not use another person's login |

## If something looks wrong

**No mail is arriving.** Expected in this environment — no account is connected yet (Part 1). Once one
is, an administrator should check **Connections** for an authorization or health warning, then
**Exceptions** for a delivery failure explaining itself.

**A request is in the queue but obviously wrong** — the wrong customer suggested, the wrong type. Correct
it on the screen and accept it, or decline it with a reason. Never let a wrong reading through because
the screen suggested it: **the suggestion is a starting point; you are the decision.**

**A Work Order was created that should not have been.** Do not try to delete anything. Record the Work
Order number and the inbound request, and raise it through the support path below.

**Never** attempt to fix inbound mail by editing records directly, sharing a login, or working around a
missing permission.

## Support and escalation

1. Your **Taylor EOS Administrator** first — most of this is configuration.
2. Anything the administrator cannot resolve goes to **Verenward** through the agreed support path.

*(The formal support and escalation procedure — severity, response commitments, the bug-versus-request
boundary — is still being established under Customer 1 gate `C1-SUPPORT-01`. Until it is agreed, use the
route your administrator gives you.)*

## Administrator notes

**Self-service:** creating and editing connections and mailboxes.

**Not self-service:** registering the Microsoft 365 or Google Workspace application, holding the
credential, changing routing rules, and granting either Role. Those are Verenward responsibilities and
are deliberately not on this screen.

Assigning someone the **Email Intake Administrator** Role lets them repoint where the company's inbound
work comes from. Assign it deliberately, and to as few people as the job needs.

## Changes in this release

- **New workflow.** Email arriving in a connected mailbox becomes a governed inbound request, and
  accepting it creates one Work Order without retyping — replacing reading an email and keying a Work
  Order by hand.
- **New Administration destination:** `Administration ▸ Email & Communications`.
- **New Service destination:** `Service ▸ Inbound Work`.
- **Two new Roles**, deliberately separate: Email Intake Administrator, Service Inbound Work Reviewer.
- **Known limitations in this release:** connecting a provider account is unavailable in this environment
  until an application is registered against it, so `Connect`, `Test connection`, `Check now` and
  `Retry now` do nothing; routing rules are read-only on screen; EOS sends no email of any kind.

## Verification receipt

```text
DEPLOYMENT: de90d6b0 (platform-sandbox Hosting, 2026-09-06)
AFFECTED ROLES: Email Intake Administrator; Service Inbound Work Reviewer
AFFECTED WORKFLOWS: Email connection/mailbox configuration; Inbound Work review, Accept, Decline, Attach
TRAINING GUIDES: docs/training/email-connections-and-inbound-work.md
TRAINING REPRESENTS: de90d6b0
TRAINING: COMPLETE
```

- Training checked against deployed release/SHA: `de90d6b0`
- Workflow exercised/visually verified: both surfaces were driven at 1440 / 1024 / 375 across all seven
  administration tabs and the queue and review screen, and the labels, buttons and messages quoted above
  are the ones the deployed build renders. Recorded in
  [`email-surfaces-north-star-review.md`](../assessments/email-surfaces-north-star-review.md).
- Screenshots current where used: `not applicable — no screenshots`
- Known sandbox-only or future behavior present in guide: `NO` — the four unavailable actions are named
  as unavailable, with the reason, rather than taught as procedure
- Training status: `COMPLETE`
