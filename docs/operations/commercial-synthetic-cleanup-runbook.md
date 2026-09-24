# Commercial Synthetic Cleanup — runbook and executed evidence

**Tool:** `functions/scripts/commercialSyntheticCleanup.js`
**Scope:** nonprod (`platform-sandbox`) only. **There is no production execution path.**
**Executed:** 2026-09-23 against the nonprod instance, tenant `taylor-nonprod`.

---

## 1. The authorization

> COMMERCIAL SYNTHETIC CLEANUP — AUTHORIZED IN NONPROD. Exact proven population: 3 synthetic Sales Orders,
> 6 synthetic Opportunities, 3 synthetic Sales Agreements. Total: 12. Use a governed cleanup script.
> DO NOT use an unrecorded ad-hoc SQL statement set.

The authorization is for **twelve named records**, not for a class of records. The tool encodes it that way: the
delete set is the frozen constant `DELETE_SET`, and there is no command-line option of any kind that can add to it,
subtract from it, or select rows by predicate.

## 2. The exact identity set

`deleteSetSha256 = 2fd32bd199605c8c2524f0783ef4e47dfc3c39ec6e142d906620d614613919c0`

Tenant `tenant-6ce59be1-1979-45cd-9d17-a4969037fb25` (`taylor-nonprod`).

| family | id | number | declared by |
|---|---|---|---|
| opportunity | `opp_3d1fdd30-9b0a-4344-983a-3598ca909494` | SYN-NP-OPP-0001 | v1 + v2 |
| opportunity | `opp_16ea0f86-3aea-4da4-8017-02dd4b1f12af` | SYN-NP-OPP-0002 | v1 + v2 |
| opportunity | `opp_3b79d076-09c1-43bf-86c1-7b3ba4e6bd82` | SYN-NP-OPP-0003 | v1 + v2 |
| opportunity | `opp_e481459d-12f2-4dab-8b2b-d574bd7a034e` | SYN-NP-OPP-0004 | v1 + v2 |
| opportunity | `opp_5880fb7c-55c7-4bc9-8fbe-bde55bfd96e1` | SAMPLE-CO-OPP-0005 | v2 |
| opportunity | `opp_61eeeb83-1518-48b9-b181-65b6174cfe8b` | SAMPLE-CO-OPP-0006 | v2 |
| salesAgreement | `sag_3f17be2a-d728-473a-b54d-efaba417362b` | SYN-NP-SA-0001 | v1 + v2 |
| salesAgreement | `sag_faf8952b-c50b-4654-b013-6d8484972e3f` | SYN-NP-SA-0002 | v1 + v2 |
| salesAgreement | `sag_c7e8d9d6-e4b8-4504-82bf-4781b9bf0510` | SAMPLE-CO-SA-0003 | v2 |
| salesOrder | `sor_d86545ba-167e-4dcd-8d70-06a958748cc8` | SYN-NP-SO-0001 | v1 + v2 |
| salesOrder | `sor_aa480123-e315-4b0e-8da4-c73dd90ab9ef` | SYN-NP-SO-0002 | v1 + v2 |
| salesOrder | `sor_2d2e1715-9e18-4e50-8d80-776890011440` | SAMPLE-CO-SO-0003 | v2 |

"v1" = `functions/scripts/fixtures/syntheticNonprodWorkforceSeed.v1.json`,
"v2" = `functions/scripts/fixtures/sampleCompany.v2.json`. Classification is by DECLARATION only: a row is
`SYNTHETIC_NONBUSINESS` because a governed manifest names its number, never because the number looks synthetic.

## 3. Procedure

Run from the Render Shell on `eos-api-nonprod` (where `EOS_ENVIRONMENT=nonprod` and `DATABASE_URL` are already set).

```
# 1. DRY RUN. This is the default. The transaction is BEGIN READ ONLY, so the database refuses a write.
node scripts/commercialSyntheticCleanup.js \
  --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
  --tenantKey taylor-nonprod --nonprodDataMutationAuthorized --performedBy <operator>

# 2. REVIEW the printed `deleteSet` (12 ids) and `preconditions.met`. Do not proceed unless met is true.

# 3. EXECUTE, restating the reviewed identity set's fingerprint.
node scripts/commercialSyntheticCleanup.js \
  --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
  --tenantKey taylor-nonprod --nonprodDataMutationAuthorized --performedBy <operator> \
  --mode apply --apply \
  --confirmExactIds 2fd32bd199605c8c2524f0783ef4e47dfc3c39ec6e142d906620d614613919c0
```

Exit codes: `0` plan complete with every precondition met, or apply committed. `1` a precondition is not met.
`2` refused or failed — and a failure after `BEGIN` rolls the whole transaction back, so nothing is ever partially
removed.

## 4. Delete order (measured, not recited)

Measured from `pg_constraint` on every run; the tool refuses if the graph it finds is not the one it encodes.
No constraint declares `ON DELETE CASCADE`, so nothing disappears implicitly.

```
eos_commercial.opportunity_lines.opportunity_id
eos_commercial.sales_agreement_lines.sales_agreement_id
eos_commercial.sales_order_lines.sales_order_id
eos_commercial.accountability_handoffs.opportunity_id
eos_commercial.accountability_handoffs.sales_agreement_id
eos_commercial.accountability_handoffs.sales_order_id
eos_commercial.sales_orders
eos_commercial.sales_agreements
eos_commercial.opportunities
```

`eos_commercial.ownership_handoffs` is APPEND-ONLY (`refuse_ownership_history_mutation` raises on UPDATE and
DELETE). It is MEASURED and never deleted from: a nonzero inbound count is a refusal, never an attempt.

The whole run holds `pg_advisory_xact_lock(hashtextextended('commercial-c5|<tenantId>', 0))` — the same key
`commercialC5Target.ts` `copyCommercial` takes — so a cleanup and a C5 copy cannot interleave.

## 5. Executed evidence, 2026-09-23

```
outcome         CLEANUP_APPLIED     applied true      rolledBack false
rowsRemoved     12                  (0+0+0+0+0+0 children, 3 orders, 3 agreements, 6 opportunities)
preFingerprint  a579d10eadb7a9c20ad9e67b236e4c994262024698209502e61f3fcad968084b
postFingerprint 38a3dd1b05257c0f31a8b309fcc749a48dd377bdc77d0e467d34b3374eeb2378
```

Before: 6 / 3 / 3 in the tenant and 6 / 3 / 3 instance-wide — the reviewed twelve were the WHOLE population.
All 14 measured inbound reference counts were 0. After: 0 / 0 / 0, all inbound counts still 0.

## 6. What the cleanup deliberately does NOT do

It does not reseed. `scripts/seedSampleCompany.js --mode apply --apply` keys on the record NUMBER, and when a
number is absent it mints a FRESH id — so a reseed recreates all twelve and re-arms the C5 blocker the Owner
authorized removing. A post-cleanup `--mode plan` proves this: `commercial CREATE 12`, `accountablePersons
CREATE 12`, `ALREADY_PRESENT 143` everywhere else. **The correct reconciliation after this cleanup is
`--mode plan` only.** Nothing outside the twelve Commercial records needs reseeding.

The consequence is recorded rather than hidden: `scripts/verifySampleCompany.js` loses 9 Commercial relationship
assertions (VERIFIED -> DANGLING), the three `commercial.*` domain counts go COMPLETE -> ABSENT, and scenario A
goes VERIFIED -> FAILED. Scenarios B and H remain VERIFIED.
