# Commercial and Legal Unresolved Decision Register

**Status: DRAFT — OPEN REGISTER, NOTHING HERE IS DECIDED.**
**Decision owner: per row. This register itself is maintained by Lane E.**
**Gates: `C1-COMM-01`, `C1-CONTRACT-01`, `C1-SUPPORT-01`.**

Every commercial, support, and legal question this lane could not answer, and
who must answer it. A row leaves this register only when the named owner has
actually decided, with the decision recorded somewhere durable — not when an
agent finds a plausible answer.

Owner codes: `OWNER` = Verenward Owner. `TAYLOR` = Taylor Freezer of Arizona.
`COUNSEL` = external legal counsel. `LANE-x` = another Customer 1 lane's gate
must produce the fact first.

## Open decisions

| ID | Decision needed | Owner | Blocks | Source |
|---|---|---|---|---|
| CD-01 | Loaded hourly rate for founder labor. `$0` is invalid — the readiness ledger names founder-labor-as-free as a production red line. | OWNER | Every labor line; the entire subscription cost floor | Cost model §4 |
| CD-02 | Scale inputs: named users, concurrent technicians, work orders/month, SKUs, PO+receipt volume, attachment volume and size. | TAYLOR | All infrastructure and support-hour quantification | Cost model §1 |
| CD-03 | Data retention period for records, attachments, backups, and audit logs. | OWNER + TAYLOR | Three largest storage cost lines; also a contract term | Cost model §2 |
| CD-04 | Cost-attribution rule when infrastructure or tooling is shared across customers, environments, or development. | OWNER | Whether §2/§3 are measurements or allocations | Cost model §2, §3 |
| CD-05 | Is the private AI assistant runtime inside Day-1 scope? | LANE-A (`C1-SCOPE-01`) then OWNER | An inference/compute cost line absent from the model; also a data-handling contract term | Cost model §2 |
| CD-06 | On-call posture: is off-hours availability priced as availability, or only as consumed hours? | OWNER | Support labor cost; support terms; the support model | Cost model §4 |
| CD-07 | Number of migration/cutover rehearsals included before additional ones are billable. | OWNER + TAYLOR | Implementation cost ceiling; implementation SOW | Cost model §5 |
| CD-08 | Length of the post-cutover stabilization period, and what happens at its end. | OWNER + TAYLOR | The boundary between implementation and recurring support | Cost model §5 |
| CD-09 | Contingency reserve percentage for the first customer of the platform. | OWNER | Cost floor | Cost model §6 |
| CD-10 | Founding-customer treatment: is there a concession, what is it worth, what does Verenward receive in return, and does it expire? | OWNER | Subscription and implementation pricing worksheets | Charter objective 2 |
| CD-11 | The bug-vs-enhancement boundary, in language Taylor and Verenward would both apply the same way to a real ticket. | OWNER + TAYLOR | Support model; sustaining-engineering cost; support terms | `C1-SUPPORT-01` |
| CD-12 | Third-party IT responsibility boundary: devices, network, printers, scanners, email, and identity provider. | TAYLOR | Support model; severity definitions; liability boundary | `C1-SUPPORT-01` |
| CD-13 | Support hours and response expectations Verenward is willing to commit to contractually. | OWNER | Support labor hours; support terms | Cost model §4 |
| CD-14 | Liability cap, warranty posture, indemnity, and insurance requirements. | COUNSEL, with OWNER instruction | Any executable agreement | `C1-CONTRACT-01` |
| CD-15 | Data ownership, confidentiality, subprocessor disclosure, and data-return format and timeline on termination. | COUNSEL + OWNER, accepted by TAYLOR | `C1-CONTRACT-01` close condition | `C1-CONTRACT-01` |
| CD-16 | Termination rights, notice period, and what Taylor is left holding operationally. | COUNSEL + OWNER | `C1-CONTRACT-01` close condition | `C1-CONTRACT-01` |
| CD-17 | Contracting entity, governing law, and venue. | OWNER + COUNSEL | Every draft agreement's signature block | `C1-CONTRACT-01` |
| CD-18 | Which admin actions remain Verenward labor at Day 1 rather than Taylor self-service. | LANE-C (`C1-ADMIN-01`) | A recurring labor line whose size is currently unknown | Cost model §4 |
| CD-19 | Does implementation carry a fixed fee, and what is the objective boundary at which additional work becomes billable? | OWNER | Implementation revenue line; implementation SOW | Worksheet W-1 |
| CD-20 | What is the subscription unit (named user, technician, flat, base-plus-metered), and does the initial-term level clear the cost floor with founder labor priced at `CD-01`? | OWNER | Subscription revenue line; the founder-labor red line | Worksheet W-2 |
| CD-21 | Is support bundled into the subscription or charged separately, and what coverage window will Verenward contract to? | OWNER | Support revenue line; support terms | Worksheet W-3 |
| CD-22 | Is there a founding-customer concession, what does Verenward receive in return, and when does it end? | OWNER, accepted by TAYLOR | Founding-customer treatment; every other worksheet's stated level | Worksheet W-4 |
| CD-23 | Is there an included change allowance during implementation, and above what threshold is a written priced change order mandatory? | OWNER + TAYLOR | Change-request revenue line; implementation SOW | Worksheet W-5 |
| CD-24 | For custom work funded by Taylor and merged into the shared platform: who owns the result, may Verenward sell it to others, and does that change what Taylor is charged? | COUNSEL + OWNER, accepted by TAYLOR | Billable custom work; IP terms in `C1-CONTRACT-01` | Worksheet W-6 |
| CD-25 | The official support intake mechanism (address, queue, ticketing tool), who operates it, and whether its cost is in the cost model. | OWNER | `C1-SUPPORT-01` intake close condition; support labor measurability | Support model §1 |
| CD-26 | Taylor's named list: who may file a support request, who may escalate, and who may accept a resolution. | TAYLOR | Intake; escalation; any dispute resolution | Support model §1, §4 |
| CD-27 | Acceptance of the S1–S4 severity definitions and the workaround/scope rules, by both parties. | OWNER + TAYLOR | `C1-SUPPORT-01` severity close condition | Support model §2 |
| CD-28 | Definition of "business hours" for support, against Taylor's actual field-operations day. | OWNER + TAYLOR | Every response-time commitment; on-call posture (`CD-06`) | Support model §3 |
| CD-29 | Coverage when the single Level 1/2 responder is unavailable (illness, travel, vacation). | OWNER | Whether any response commitment is honestly makeable | Support model §4 |
| CD-30 | Where "accepted behaviour" is durably recorded, such that both parties can point at it when classifying a ticket. | OWNER, confirmed by TAYLOR | The bug-vs-enhancement test (`CD-11`) has no baseline without it | Support model §5 |
| CD-31 | Does Taylor have an IT function to own the device/network/printer/email/identity rows? If not, who does, and is that labor priced? | TAYLOR then OWNER | Third-party IT boundary (`CD-12`); unpriced support labor | Support model §6 |

## Rules for this register

1. A row is not removed because it became inconvenient, or because a downstream
   draft needed an answer. It is removed when the named owner decided.
2. No agent may answer a `TAYLOR` or `COUNSEL` row. Those are customer facts and
   legal judgments respectively.
3. A `LANE-x` row is answered by that lane's gate output, then confirmed here.
4. New rows are added by any Lane E draft that hits a question it must not
   answer. That is the expected outcome, not a failure.

## Open issues

- No row has an owner-confirmed answer yet. The register has grown twice
  already — CD-19 through CD-24 from the pricing worksheets, CD-25 through
  CD-31 from the support operating model — and is expected to grow again as the
  draft agreements are written.
- CD-19 through CD-24 are structural pricing decisions and are all gated on
  CD-01 and CD-02 being answered first; deciding them earlier means choosing a
  structure without being able to size its trade-off.
- `COUNSEL` has not been engaged. Rows CD-14 through CD-17 cannot progress at
  all until that happens, and nothing in this lane substitutes for it.
