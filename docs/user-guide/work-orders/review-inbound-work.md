# Review inbound work

**Service → Inbound Work**

Work that arrived by email — from Taylor Corporate, a vendor or a manufacturer — waiting for you to decide.
Accepting one creates the Work Order for you, already filled in from the email.

## The queue

Each row is one request: when it arrived, who sent it, the subject, what EOS classified it as, and where it
is up to. Requests marked **Needs review** are the ones a rule flagged, or where a reply could have belonged
to more than one open request.

Select a row to open it.

## The review screen

Two sides, side by side, because you are comparing them:

**Left — the original message.** Exactly what arrived: sender, recipients, when, the subject, the message
itself, its attachments and which mailbox it came into. It is evidence and cannot be edited. Later replies
on the same thread appear underneath it.

**Right — what EOS made of it.** The request type, the customer, the site, the unit, the model and serial,
the warranty or authorization number, the vendor reference, the problem, the priority, and how it was routed.

Anything EOS could not find is **blank and says so** — it never invents a value. Where it did find something,
it says what it matched on, for example a serial number that resolved to one of your units.

**Everything on the right is a suggestion you can change.** Choosing a different customer clears the site and
unit picked under the old one, so a leftover selection can never be submitted by accident.

## Your four choices

### Accept Job

Creates **one** Work Order, with the customer, site, unit, warranty or authorization number and the problem
already on it. You are taken straight to it.

Nothing is re-typed, and nothing is guessed at: EOS checks that the customer, site and unit you chose really
exist and really belong together before it creates anything.

**Pressing it twice does not create two jobs.** A second press — or a retry after a slow response, or a
colleague pressing it at the same moment — returns the job that already exists.

### Decline Job

For work you are not taking: outside the service area, unsupported equipment, no capacity, a duplicate, a
customer account issue, an invalid request, or another reason you note.

The request is **kept**, with who declined it, when and why. Nothing is deleted, so the reasons stay
available for reporting.

### Attach to Existing Work

When the email is about a job you already have. The request, its message and its attachments are filed
against that Work Order and **no new job is created**.

### Leave it

A request you are not ready to decide stays in the queue exactly as it is.

## Replies do not create second jobs

When somebody replies on the same email thread — "any update?" — the reply is kept with the request it
belongs to. No second job appears.

EOS matches on the provider's own thread identifiers and the message ids a reply answers, never on the
subject line, because subject lines repeat. If a reply genuinely could belong to more than one open request,
it is marked for review rather than being attached to the wrong one.

## What you may not be able to do

Reading the queue, accepting, declining and attaching are separate permissions. If a control is unavailable
or the screen tells you something is not part of your role, that is a permission fact — ask an administrator
if you believe you need it.

Setting up mailboxes and routing rules is administration work and lives in
[Administration → Email & Communications](../administration/set-up-email-connections.md).

## Two things worth knowing

- **Attachments are listed, not stored inside EOS yet.** Filename, type, size and where the attachment came
  from are kept with the request; the file itself stays retrievable through the connected mailbox.
- **Accepting never edits your customer records.** If the email spells the site address differently or names
  a contact you do not have, the Work Order uses what you confirmed and your customer, site, contact and
  equipment records are left exactly as they are.
