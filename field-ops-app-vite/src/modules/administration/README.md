# Connecting to Existing Company Infrastructure FAQ

This module provides the end-to-end guidance for connecting Field Ops to systems a company already uses, including ERP, accounting, CRM, business-intelligence, data-warehouse, reporting, and AI platforms.

The page is guidance and intake preparation. It does not create a live connection, store credentials, test an external system, or imply that a named vendor connector is already available.

## Where the page lives

Authenticated administrators and dispatchers can open:

**Administration → Integrations**

The client-side route is:

```text
/administration/integrations
```

`src/navigation/navConfig.js` defines the navigation item. `src/App.jsx` maps that item to `IntegrationsFaq.jsx`. Existing role-visibility rules limit the page to the roles that can access Administration placeholders: `admin` and `dispatcher`.

## End-to-end user journey

1. A user signs in to Field Ops with an administrator or dispatcher role.
2. The user opens **Administration**, then selects **Integrations**.
3. The page introduces the three non-negotiable integration principles:
   - Field Ops remains authoritative for the operational records it owns.
   - Every external connection crosses a controlled security boundary.
   - An external-system outage must not stop core Field Ops work.
4. The user reviews the readiness checklist and identifies:
   - the business outcome and sponsor;
   - the systems being connected;
   - ownership for each kind of data;
   - whether data moves inbound, outbound, or both;
   - timing, frequency, and volume expectations;
   - security and support owners; and
   - available sample files or API documentation.
5. The user browses questions by category or searches across question and answer text.
6. The user expands an answer to understand the relevant architecture and delivery expectation.
7. The user gives the completed readiness information to the Field Ops administrator or platform owner through the company's approved request process.
8. The proposed connection is reviewed against the integration architecture before it is designed or scheduled.

Credentials and production data must not be included in the initial request. They should be shared only through an approved secure process after the connection has an owner and an agreed design.

## What happens after a request

The FAQ prepares a request; it does not automate the approval process. A complete request should move through these stages:

1. **Outcome review** — confirm the business need and responsible sponsor.
2. **System-boundary review** — decide which system owns each record and prevent competing sources of truth.
3. **Pattern selection** — select export/extract, import/ingest, event notification, customer-hosted agent, or an approved combination.
4. **Contract design** — define identifiers, fields, validation, mapping, frequency, error behavior, and reconciliation.
5. **Security review** — select a narrowly scoped integration identity and an approved credential-handling process.
6. **Implementation** — build against the stable platform boundary without adding direct Firestore access or a second operational write path.
7. **Verification** — test success, rejected input, duplicate delivery, external outages, retries, and reconciliation.
8. **Operational handoff** — document monitoring, support ownership, credential rotation, incident response, and change management before enabling production traffic.

## Supported connection patterns

| Pattern | Direction | Typical use |
| --- | --- | --- |
| Export / Extract | Field Ops → external system | BI, data warehouse, accounting, ERP, and reporting feeds |
| Import / Ingest | External system → Field Ops | Approved reference or master data that passes Field Ops validation |
| Event Notification | Field Ops → external system | Inform another system that an operational event occurred |
| Customer-Hosted Agent | Bidirectional, customer-operated | Mediate between a hosted Field Ops instance and company-managed infrastructure |

The transport is chosen during design. A pattern may use a file, scheduled batch, API, webhook, stream, or customer-hosted process, depending on the approved requirement.

## System and data boundaries

- Firestore remains the operational system of record for Field Ops data.
- External systems do not query or write Firestore directly.
- Exports create downstream copies and do not mutate the operational record.
- Imported information is untrusted until it passes normal Field Ops domain validation.
- An import must use the sanctioned write path for the affected business object.
- External systems remain authoritative for their own native domains, such as an accounting ledger or CRM pipeline.
- Conflicting inbound information must be rejected or surfaced for reconciliation; it must not silently overwrite authoritative data.
- Integration failures must not block or roll back core operational work.

The authoritative policy is [`docs/IntegrationArchitecture.md`](../../../../docs/IntegrationArchitecture.md). If this README, the FAQ copy, and that document ever disagree, the architecture document controls.

## Page behavior

The FAQ content is stored in the `FAQS` array in `IntegrationsFaq.jsx`. Each item has:

```js
{
  category: "Security & reliability",
  question: "How are integrations authenticated?",
  answer: "...",
}
```

Categories are derived from the FAQ data, so adding the first question in a new category automatically adds a filter button.

Search is:

- case-insensitive;
- applied to both question and answer text;
- combined with the active category filter; and
- performed locally in the browser without sending search text anywhere.

Answers use native HTML `details` and `summary` elements, giving keyboard users built-in expand and collapse behavior. The first visible answer opens by default when the page is not showing a search result.

## Updating the FAQ

1. Edit the `FAQS` array in `IntegrationsFaq.jsx`.
2. Use plain language and answer one question per entry.
3. Reuse an existing category unless the subject genuinely needs a new one.
4. Confirm every architectural statement against `docs/IntegrationArchitecture.md`.
5. Do not promise a vendor connector, protocol, endpoint, delivery date, or authentication method that has not been approved and implemented.
6. Keep the readiness checklist aligned with the information required by the integration review process.
7. Run the production build from `field-ops-app-vite` before delivery.

## Verification checklist

After a content or behavior change, verify:

- an administrator or dispatcher can open **Administration → Integrations**;
- a technician cannot gain Administration access through this page;
- every category shows the correct questions;
- search matches words in questions and answers;
- combining search and a category gives the expected subset;
- a no-results message appears for an unmatched search;
- questions expand and collapse with a mouse, keyboard, and touch input;
- focus remains visible on search, filters, and question summaries;
- the layout remains readable on a narrow screen; and
- the production build completes successfully.

## Implementation map

| Concern | Location |
| --- | --- |
| FAQ content and interaction | `src/modules/administration/IntegrationsFaq.jsx` |
| Route-to-page mapping | `src/App.jsx` |
| Administration navigation and role visibility | `src/navigation/navConfig.js` |
| Visual and responsive styles | `src/index.css` |
| Authoritative integration policy | `docs/IntegrationArchitecture.md` |

## Current limitations

- The page is informational and does not submit an integration request.
- It does not display connection status, transfer history, or errors.
- It does not manage credentials or configuration.
- It does not provide vendor-specific setup instructions.
- Named integrations remain subject to architecture, security, delivery, and support review.

These limits are intentional. A future request workflow or connection-management screen should be designed as a separate capability and must preserve the boundaries described above.
