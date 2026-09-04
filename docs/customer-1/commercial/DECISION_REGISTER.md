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

## Rules for this register

1. A row is not removed because it became inconvenient, or because a downstream
   draft needed an answer. It is removed when the named owner decided.
2. No agent may answer a `TAYLOR` or `COUNSEL` row. Those are customer facts and
   legal judgments respectively.
3. A `LANE-x` row is answered by that lane's gate output, then confirmed here.
4. New rows are added by any Lane E draft that hits a question it must not
   answer. That is the expected outcome, not a failure.

## Open issues

- No row has an owner-confirmed answer yet; this register is at its first
  revision and is expected to grow as the pricing worksheets, support model, and
  draft agreements are written.
- `COUNSEL` has not been engaged. Rows CD-14 through CD-17 cannot progress at
  all until that happens, and nothing in this lane substitutes for it.
