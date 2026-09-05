# Email provider setup — connecting a real Microsoft 365 or Google Workspace mailbox

**Status:** operator runbook for a **non-production** environment. Production provider binding is **not
authorized** and is refused in code (see [Production refusal](#production-refusal)).

Everything EOS can do without an external administrator is already built and tested. What remains is the
part that only your Microsoft or Google administrator can do: register an application, consent to a
read-only scope, and hand EOS the resulting client credential. This page is that work, in order, with
nothing invented — every id below is a placeholder you replace with a real one.

## What you will end up with

```text
Entra / Google Cloud application  ──►  client id + client secret
                                            │
                              bound as Firebase secrets
                                            │
Administration ▸ Email & Communications ▸ Connect
                                            │
              administrator consents (read-only)
                                            │
        refresh token ──► Secret Manager (EOS never stores it in Firestore)
                                            │
              every 5 minutes: poll ▸ intake ▸ Inbound Work
```

## 1. Microsoft 365

Performed by a Microsoft Entra ID administrator for the tenant that owns the mailboxes.

1. **Register an application** (Entra ID → App registrations → New registration).
   - Name it for what it is, e.g. `EOS Email Intake (sandbox)`.
   - Supported account types: single tenant, unless your mailboxes live elsewhere.
2. **Add the redirect URI**, as a *Web* platform. It is the Email & Communications screen itself:
   ```text
   https://<your-eos-host>/administration/email-communications
   ```
   For a local development run this is `http://localhost:5173/Taylor_Parts/field-ops/administration/email-communications`.
   The redirect must match **exactly** — EOS binds it into the authorization state and refuses a callback
   that names a different one.
3. **Add delegated permissions** (API permissions → Microsoft Graph → Delegated):
   | Permission | Why |
   | --- | --- |
   | `offline_access` | a refresh token, so intake keeps working without an administrator present |
   | `Mail.Read` | read the connected account's own mail |
   | `Mail.Read.Shared` | read the shared Service / Warranty / Parts mailboxes it has been granted |

   **Do not add `Mail.Send` or `Mail.ReadWrite`.** EOS never sends, modifies, moves or deletes a message,
   and asking for authority nothing exercises is how a read-only integration becomes a write-capable one.
4. **Grant admin consent** for the tenant.
5. **Create a client secret** and copy the value once — it is shown only at creation.
6. **Give the connected account access to each shared mailbox** (Exchange admin centre → Mailboxes →
   delegation → Read and manage). Without this, authorization succeeds and the mailbox check fails, which
   EOS reports as `CONNECTED / FAILED` with exactly that reason.

## 2. Google Workspace

Performed by a Google Workspace administrator, in a Google Cloud project.

1. **Enable the Gmail API** for the project.
2. **Configure the OAuth consent screen** as Internal, for your Workspace organisation.
3. **Create an OAuth client id** of type *Web application*, with the same redirect URI as above.
4. **Scope:** `https://www.googleapis.com/auth/gmail.readonly`, and nothing else. Not `gmail.modify`, not
   `gmail.send`.
5. Note the client id and client secret.

Gmail authorizes **as the mailbox account**: the person completing the connection signs in as the mailbox
owner. EOS verifies this — if the authorized profile is not the configured address, the connection is
refused with both addresses named, rather than silently polling the wrong mailbox.

## 3. Bind the credentials to the environment

The four values are read from the environment under these exact names, bound through Firebase Secret
Manager (the convention this repository already uses for server-only configuration):

```bash
# Run once per environment, by the human operator who holds deployment credentials.
firebase functions:secrets:set EMAIL_MICROSOFT_CLIENT_ID     --project <non-production-project>
firebase functions:secrets:set EMAIL_MICROSOFT_CLIENT_SECRET --project <non-production-project>
firebase functions:secrets:set EMAIL_GOOGLE_CLIENT_ID        --project <non-production-project>
firebase functions:secrets:set EMAIL_GOOGLE_CLIENT_SECRET    --project <non-production-project>
```

Set only the pair for the provider you are connecting; Administration → Email & Communications shows which
of the two this runtime has, and offers Connect only for a provider it can actually authorize.

**The runtime service account additionally needs `roles/secretmanager.admin`** (or a narrower custom role
with `secretmanager.secrets.create`, `versions.add`, `versions.access`, `secrets.delete`) so EOS can hold
each connection's refresh token as its own secret. This is the credential custody described in
[the architecture document](../architecture/email-connections-and-inbound-work.md#credential-custody).

## 4. Deploy

```bash
# Functions: the transport callables and the five-minute poller.
firebase deploy --only functions --project <non-production-project>

# Storage rules: deny every client. EOS reads attachment bytes server-side and hands them to an
# authorized reviewer through a governed callable; no browser reads the bucket.
firebase deploy --only storage --project <non-production-project>
```

The bucket itself is the environment's default Firebase Storage bucket; no separate provisioning step is
required beyond having Storage enabled on the project.

## 5. Connect, in the product

1. **Administration → Email & Communications → Connections → Add a connection.** Provider, tenant id (or
   Workspace domain), and the account that will hold the authorization. No secret is entered here — there
   is no field for one.
2. **Mailboxes → Add a mailbox** for each operational mailbox (Service, Warranty, Parts).
3. **Connections → Connect.** You are sent to the provider, you consent, and you come back to this screen.
   EOS exchanges the code server-side, takes custody of the refresh token, and reads each configured
   mailbox before it calls the connection connected.
4. **Test connection** whenever you want to re-check: it reads, and does nothing else — no message is
   ingested, nothing is sent, and no provider-side state changes.
5. **Mailboxes → Check now** polls immediately rather than waiting for the five-minute cycle.

## Production refusal

Every transport callable and the scheduled poller check the runtime's own project identity **before any
authority is evaluated**, and refuse:

- the production project by name;
- any environment whose registry role is `production`;
- any project not in `config/environments.json` at all.

There is no flag, setting or payload that lifts this. Production provider binding, production polling and
production attachment ingestion require a separate Owner authorization and a code change, in that order.

## What to check when something is wrong

| What Administration says | What it means | What to do |
| --- | --- | --- |
| `NOT_CONNECTED` | never authorized, or disconnected | Connect |
| `PENDING_AUTHORIZATION` | started, not finished | Connect again; an abandoned attempt expires in 10 minutes |
| `CONNECTED` + health `FAILED` | authorized, but a mailbox cannot be read | grant the connected account access to the mailbox, then Test connection |
| `EXPIRED` / `REVOKED` | the provider no longer accepts the stored authorization | Connect again (reauthorize) |
| Exceptions: `PROVIDER_RATE_LIMIT` / `PROVIDER_UNAVAILABLE` | transient | nothing; it retries on its own |
| Exceptions: `MAILBOX_ACCESS_DENIED` / `MAILBOX_NOT_FOUND` | configuration | fix the mailbox or its delegation, then Retry now |
| Exceptions: `ATTACHMENT_FETCH_FAILED` | the message arrived, a file did not | Retry now; the request is already in the queue and is marked PARTIAL |
| Exceptions: `DELIVERY_RETRY_EXHAUSTED` | retried to the limit | fix the cause, then Retry now |

Nothing in the Exceptions list contains a token, a provider payload or a credential: it carries a code, a
sentence, and a count.
