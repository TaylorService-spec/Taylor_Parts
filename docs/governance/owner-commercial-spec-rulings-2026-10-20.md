# Owner rulings on the seven commercial specifications (2026-10-20)

**Status:** governed decision register. Recorded by the engineering controller from the Owner's review "OWNER REVIEW — 110 COMMERCIAL SPEC DECISIONS" (2026-10-20). Enterprise Operations OS is developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools.

**Baseline accepted by the Owner:** the classification of the 110 decisions (23 parity, 16 previously ruled, 49 technical, 22 Owner IDs = 19 distinct questions), as recorded in the classification note. The specifications are the open PRs #2175 (F-1), #2167 (S1a), #2172 (Q-1), #2170 (D-1), #2171 (W-1), #2173 (T-1) and #2174 (REC). Where a spec recommendation conflicts with this register, **this register wins**.

**Operating constraints:**
- ONE active lane.
- Implement in this order: Finance → Reservations / Sales Orders → Quotes → Delivery → Warranty → Territories → Recovery.
- Every batch gets independent review, CI, protected merge, nonprod deployment and employee-based runtime acceptance.
- **Not authorized:** production action, destructive Firebase retirement, historical-copy execution, emergency-recovery activation, external payment execution. Each needs separate Owner approval.
- Training documentation comes last.

---

## 1. Approved choices

### F-1 Invoicing
| ID | Ruling |
|---|---|
| OD-F1-1 / OD-F1-4 | **Issue:** ordinary authorized invoice issuance needs **no** second approver.<br>**Second approver:** nonzero credits, write-offs, financial adjustments to an issued invoice, refunds and eligible voids each need approval by a **separate authorized Employee**. The initial threshold is **$0**.<br>**Authority:** explicit Finance approval capabilities, governed company scope, and the existing protected authority. No requester self-approval.<br>**Grants:** reconcile with existing finance policies before granting any new authority. |
| OD-F1-9 | **Void** of an issued invoice is allowed **only before any settlement or adjustment is applied**, with a reason and two-person authorization. Otherwise the governed correction / credit procedure applies. The original invoice number, history and audit are preserved. |
| OD-F1-11 | Recording a **refund obligation and its reconciliation** is authorized. **Actual external cash-out / payment execution is NOT authorized.** A new settlement kind is not to be read as permission to pay out. |
| OD-F1-12 | **No historical Firebase invoice copying at this stage.** This hold does **not** abandon historical access or invoice-number continuity: numbering must stay seedable for later continuity. |

### S1a Reservations
| ID | Ruling |
|---|---|
| OD-2 | A **hard reservation must identify operatingCompanyId AND a warehouse / inventory location**.<br>Company-wide **visibility** and **unallocated demand** are allowed. Unallocated demand is **not** a hard reservation.<br>**Do not infer company from warehouse.**<br>Prevent overselling, duplicate claims and cross-company commitments.<br>**DECISIONS #165 is preserved** (the spec's location-less pool recommendation is NOT adopted). Any clearly identified conflict with #165 goes to separate review. |

### Q-1 Commercial
| ID | Ruling |
|---|---|
| Q1-11 | **Enforce operating-company authority** on commercial reads, writes, approvals, records and exports.<br>Preserve distinct customer ownership, salesperson / team reach, national-account access and historical attribution.<br>Preserve the existing governed protected-Administrator authority; do **not** silently expand or reduce it. |
| Q1-7 | A discount within configured authority proceeds normally. An **over-limit discount needs approval by a different Employee** with sufficient, explicitly governed discount authority. **No invented discount percentages.** |
| Q1-14 | The five-key capability model is **conditionally authorized**. Before activation, verify the intended holders, effective grants, company bounds and existing authority. No inherited blanket sales approval and no unreviewed default grants. |
| Q1-4 | A change after customer acceptance needs **immutable revised terms, renewed acceptance and audited relationships**.<br>Controlled correction is allowed **only before dependent fulfillment or financial effects**. Never silently reopen an accepted commitment, create a second Sales Order or discard the original terms.<br>If dependent transactions exist, **refuse** the simple revision path; a separately governed correction process is required. |
| Q1-5 | Build an **explicit customer decline**, distinct from seller withdrawal and from cancellation. Keep the actor, reason, date and audit. |

### D-1 Delivery
| ID | Ruling |
|---|---|
| OD-10 | Build **versioned, company-specific acknowledgment templates** and evidence custody. **Customer-facing, legally operative language is NOT approved** until Owner / counsel review. Invent no title-transfer or contractual terms. |
| OD-11 | Completing a DELIVERY or INSTALL work order **requires an acknowledgment outcome**. ACCEPTED is **not** required: NOT_OBTAINED with a recorded reason satisfies the requirement. Support offline capture and replay where required. Keep delivery, installation, customer acknowledgment and legal title transfer distinct. |

### W-1 Warranty
| ID | Ruling |
|---|---|
| OD-6 / D-1 OD-17 | **Configurable warranty start basis**, using authoritative terms. Installation date (Taylor-installed) and acknowledged delivery date (delivery-only) are **provisional defaults only where the applicable coverage terms permit**. Invent **no** manufacturer warranty entitlements. Keep serial, customer, manufacturer, source event and audit. |

### T-1 Coverage
| ID | Ruling |
|---|---|
| OD-T1-1 / OD-T1-17 | **Nonprod activation** of the four admin / owner `coverage.read` and `coverage.write` pairs is authorized **after** exact grant and effective-authority verification. Production is unchanged. |
| OD-T1-16 | **Self-scoped My Book reads** for Retail Sales and National Accounts Sales, within existing company, customer and coverage reach. No cross-company or unrelated-account disclosure. Coverage does not change ownership, historical credit, commissions or security. |

### REC Account recovery (design authority only; nothing is activated)
| ID | Ruling |
|---|---|
| OD-1 | Design **both** secondary-Owner resilience **and** an independent emergency operator recovery ceremony. |
| OD-4 | Separate custodian authorization from operator execution. The recovering person cannot self-authorize. |
| OD-5 | Do **not** appoint custodians automatically. The named custodians remain a reserved Owner decision. |
| OD-6 | Model a **provisional** 24-hour ordinary delay and 72-hour expiry. Prepare an emergency-exception design separately. **Do not activate** until final security-policy acceptance. |
| OD-9 | Require **two independent identity-verification channels** plus attestation. A trusted callback procedure must be documented and tested. |
| OD-10 | Emergency recovery **may revoke** displaced or compromised sessions and credentials when it executes successfully. Routine password reset and session-preservation policy is unchanged. No production identity activation without separate authorization. |

## 2. Conditional choices (approved, subject to a verification gate)
- **Q1-14 five quote keys:** holders, effective grants, company bounds and existing authority are verified before any grant migration.
- **T-1 coverage pairs:** exact-grant and effective-authority check first; nonprod only.
- **F-1 approval capabilities:** reconciled with existing finance policies, including R3 / #193 (Parts Manager revoked) and the A6 summary keys, before any grant.

## 3. Deferred activation (needs separate Owner approval)
- **Production:** every production grant, activation or deploy. This includes coverage, Finance approval and quote keys.
- **Legal:** customer-facing acknowledgment / signature language (Owner and counsel).
- **Security:** emergency recovery activation, the custodian appointment, and the emergency-exception design.
- **Payments:** external payment / refund cash-out and commission payouts.
- **History:** historical Firebase invoice (and other) copies, and invoice-number continuity seeding.

## 4. Tests required (beyond each batch's standard authorization, isolation, replay and zero-trace-on-refusal suite)
- **F-1:**
  - issue with no approver;
  - each money action (credit, write-off, adjustment, refund, void) refused without a separate approver, and refused as self-approval;
  - $0 threshold;
  - void refused after any settlement or adjustment;
  - the original invoice number and history are preserved;
  - a refund creates no external payment.
- **S1a:**
  - a hard reservation without a company or a location is refused;
  - company is never derived from the warehouse;
  - no oversell under concurrency;
  - duplicate claim refused;
  - cross-company claim refused;
  - unallocated demand is never counted as a hard reservation.
- **Q-1:**
  - a foreign-company commercial read, write, approval or export reads as nonexistent;
  - a protected Administrator's reach is unchanged (before / after diff);
  - an over-limit discount is refused without a different, sufficient approver;
  - revision after acceptance is refused once fulfillment or financial effects exist;
  - no second Sales Order;
  - decline vs withdraw vs cancel are distinct.
- **D-1:**
  - DELIVERY / INSTALL completion refused without an outcome;
  - NOT_OBTAINED + reason accepted;
  - offline replay;
  - **capability reuse grants no unrelated technician write** (finding 3);
  - template versions are company-specific;
  - legal text stays a held placeholder.
- **W-1:**
  - **expiry boundary arithmetic, including leap years (Feb 29) and month-end** (finding 2);
  - the start basis is configurable;
  - no derived entitlement without authoritative terms.
- **T-1:**
  - My Book is self-scoped;
  - no cross-company or unrelated-account disclosure;
  - coverage changes no ownership or credit.
- **REC (design-stage):**
  - two-channel verification;
  - no self-authorization;
  - provisional delay and expiry;
  - revocation only on emergency execution.

## 5. Additional Owner findings, recorded
1. **Service Work Order invoicing remains an explicit B5 item.** F-1 Sales Order invoicing alone does not complete service billing. This follows the Owner decision of 2026-08-25, `InvoiceOrigin = SALES_ORDER | WORK_ORDER`, and the Service Billing Policy deferral (#191 item 6).
2. Warranty expiration boundary arithmetic is a required test (§4 W-1).
3. Delivery-acknowledgment capability reuse must not authorize unrelated technician writes (§4 D-1).
4. New legal acknowledgment language stays **held**.
5. Firebase historical-copy holds must **not** erase legitimate historical-record requirements.
6. Recording refunds or commissions never triggers payouts or external transfers.
7. The security and model consequences of the 49 technical decisions are reviewed before implementation. See §6.

## 6. Technical decisions with security or model consequences (finding 7)
The other technical decisions are table shapes, vocabulary, UX placement or scope trims with no authority effect. These are flagged; each batch's review must check its item explicitly.

| Spec / ID | Consequence | Control |
|---|---|---|
| F-1 OD-F1-11 refund settlement kind | Could be misread as payout authority | Record-only (§1). No disbursement execution path; a test proves it. |
| F-1 OD-F1-2 1:1 invoice to receivable | The invoice is a document over the AR obligation, not a second balance | Outstanding is read only from the obligation; a test shows invoice and obligation totals never diverge. |
| S1a OD-3 what a warehouse-scoped reader sees as available | Information disclosure across scope | Disclose nothing out of scope (UNKNOWN / SCOPE_PARTIAL, never a wrong number), per #165 ruling 2. |
| S1a OD-9 / OD-10 SO claim storage and hand-over | A second authority for allocated quantity | One commitment pool, one arithmetic. No `allocatedQty` authority (#165 ruling 1). |
| D-1 OD-15 reusing `workOrder.execution.record` | **Widens the stated meaning of an existing key** | Assigned-Employee-only (RECORD_ASSIGNMENT). A test proves no unrelated technician write (finding 3). |
| D-1 OD-9 signature image stored in PostgreSQL | Personal data and evidence custody | Size cap; separate read; never in lists; retention per the record. Covered by D-1 OD-10 custody. |
| D-1 OD-12 offline capture | Replay integrity | Idempotent replay; server clock is authoritative; the device clock never starts a warranty. |
| W-1 OD-15 tenant-wide terms | A company sees another company's terms | Terms are reference data; coverage carries the Equipment's company. Verify no cross-company coverage read. |
| W-1 OD-7 `installed_on` from the server clock | Offline lag shifts the date | Correctable with audit; Owner may revisit. |
| T-1 OD-T1-8 server-known account ids only | Positive: a caller cannot assert coverage | Keep. |
| REC OD-7 / OD-8 / OD-13 / OD-16 | All security-domain | Design only; no activation (§3). |

## 7. Remaining genuine Owner inputs (not previously answered)
1. **REC:** the named recovery custodians (OD-5), and final security-policy acceptance before any recovery activation.
2. **D-1:** customer-facing acknowledgment and signature language (Owner and counsel).
3. **Q-1:** the actual configured discount-authority limits per person or role. These are set, not invented, before over-limit approvals go live.
4. **F-1 / history:** when and how historical invoice access and number continuity are restored.
5. **Service Work Order billing:** the Service Billing Policy (#191 item 6) for the WO invoicing path.
6. **Goals (new):** should a goal measure be restricted to the roles that own it? Today any of the eight manager roles may author any measure within reach (Firebase parity).
7. **Production activation:** each production grant or deploy, per batch.
