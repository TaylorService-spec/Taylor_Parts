# Set up email connections

**Administration → Email & Communications**

Connect the mailboxes work arrives in — Service, Warranty, Parts — so an email from Taylor Corporate, a
vendor or a manufacturer turns into a reviewable request instead of something somebody has to re-type.

> **Sandbox only, for now.** This works in the sandbox and nowhere else. It is switched off in the live
> system in the code itself, not by a setting somebody could change by accident — the screen will tell you
> so rather than half-working.
>
> Connecting a real mailbox also needs your Microsoft or Google administrator to register an application
> once, per environment. That is a separate, one-time job: see
> [Email provider setup](../../deployment/email-provider-setup.md).

## What the sections are

| Section | What it is for |
| --- | --- |
| **Overview** | How much has arrived and what state it is in. Every number is counted from real records — an environment with no mail shows zeroes. |
| **Connections** | The link to Microsoft 365 or Google Workspace. |
| **Mailboxes** | The actual mailboxes work arrives in. One connection usually has several. |
| **Routing Rules** | How EOS classifies what arrives and where it goes. |
| **Processing** | Who reads the message — base EOS, or an optional integration product. |
| **Processing History** | What has been decided. |
| **Exceptions** | What could not be processed, and why. Nothing is ever thrown away. |

## 1. Add a connection

A connection is your organisation's link to a provider. You need:

- a name you will recognise ("Operations 365");
- the provider — **Microsoft 365 / Outlook** or **Google Workspace / Gmail**;
- your Microsoft tenant id, or your Google Workspace domain;
- the account the authorization is held against.

**EOS never stores a mailbox password and never stores an OAuth token.** There is no field for one, and if a
value that looks like a password, token or client secret is sent anyway, the system refuses to save it
rather than quietly dropping it. Where a credential is needed it is held outside EOS and the connection
records only its **name**.

A new connection is saved as **not connected**. Saving a form cannot mark a connection authorized — only
completing the authorization with the provider does that.

### Connect it

Press **Connect**. You are sent to Microsoft or Google, you sign in as the account that owns or can read
the mailboxes, and you accept a **read-only** request. You come straight back to this screen.

EOS then does three things before it calls the connection connected:

1. exchanges the one-time code for a credential — server-side, so your browser never holds one;
2. stores that credential in the platform's secret store, not in any record you can read;
3. **opens each mailbox you configured.** A connection that signs in successfully but cannot read the
   warranty mailbox is not connected, and says exactly that.

If the connection needs renewing later, press **Connect** again — the button reads **Reauthorize** once a
connection is live.

### Test it, any time

**Test connection** re-checks the credential and re-opens each mailbox. It reads and nothing else: no
email is sent, nothing is marked or moved in the mailbox, and no work is created. It is safe to press
whenever you want to know where you stand.

### Disconnect

**Disconnect** destroys the stored authorization rather than hiding it. Mail stops arriving immediately.
Everything already taken in — requests, messages, attachments, the Work Orders they became — is untouched.

## 2. Add mailboxes

The connection is the link; a mailbox is the thing people actually send to. One Microsoft or Google
connection usually exposes several — typically Service, Warranty and Parts.

For each mailbox, set:

- the connection it belongs to;
- the address and a display name;
- its **purpose** — Service, Warranty, Parts or Other;
- optionally a default queue and an operating company.

New mailboxes require review by default: everything that arrives waits for a person. That is deliberate.

Once the connection is live, EOS checks each mailbox **every five minutes**. **Check now** polls
immediately, which is the quickest way to confirm a new mailbox works: send yourself a test message and
press it.

**Connecting a mailbox does not import its history.** EOS notes where the mailbox is up to and takes in
what arrives from then on — connecting an inbox with ten years of mail in it does not create ten years of
inbound work.

## 3. Write routing rules

A rule says: *when a message looks like this, treat it as this kind of work*.

It can look at the sender's address or domain, which mailbox it arrived in, words in the subject or body,
and whether there are attachments. It can set the request type, the destination, the queue, the operating
company, the priority, and whether a person must review it before deciding.

Rules are tried **in order, and the first match wins**. A message that matches no rule is still taken in —
classified as Service and flagged for review. It is never guessed at, because a wrong guess is how a vendor
email becomes a wrongly-billed warranty job.

A typical first rule:

```text
WHEN   the sender's domain is your corporate domain
AND    it arrived in the warranty mailbox
THEN   request type = WARRANTY
       destination  = SERVICE
       queue        = WARRANTY_REVIEW
```

## 4. Check Processing

Base EOS reads the message itself: it pulls out the warranty or authorization number, the reference, the
model and serial and the problem described, and suggests the customer, site and unit from your own records.
**No add-on is needed for any of it.**

VDX and other integration platforms are optional enhancements. Where one is licensed and configured it
supplies the same information in the same shape, and the queue, the review screen and the Work Order that
gets created all behave identically. Choosing a different provider is a separate, licensed configuration
step and is not available in this build.

## 5. Watch Exceptions

Nothing is discarded. A message that arrived in a mailbox EOS does not know, or that failed processing, is
kept with the reason so somebody can look at it. Duplicates — the same message delivered twice — are kept
too, and never turn into a second job.

**Delivery failures** appear here too, with what to do about them:

| What you see | What it means |
| --- | --- |
| The provider was busy or unavailable | Nothing to do. It retries on its own. |
| The authorization expired or was revoked | Press **Reauthorize** on the connection. |
| The mailbox cannot be found or read | Fix the address, or give the connected account access to it. |
| An attachment could not be retrieved | The message itself arrived and is in the queue. Press **Retry now**. |
| Retries exhausted | Fix the cause, then press **Retry now**. |

**Retry now** re-checks the mailbox from where it left off. It cannot create a duplicate request or a
second copy of a file: EOS recognises what it already has.

## Who can do this

Setting up connections, mailboxes and rules is **administration** authority. Reviewing and accepting the
work that arrives is **Service** authority, and they are separate on purpose: a coordinator who works the
Inbound Work queue every day cannot repoint the company's mail, and an administrator who configures the
mailboxes cannot accept, decline or attach a job.

If a section says it is not part of your role, that is a permission fact, not a fault.

**Next:** [Review inbound work](../work-orders/review-inbound-work.md).
