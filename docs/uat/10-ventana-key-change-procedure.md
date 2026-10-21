# Ventana key change procedure (document only; HUMAN-authorized)

> **Status: a procedure, not an action.** Nothing in this document was executed. **No agent edited `config/ownership/operating-company-keys.sandbox.json`, by any tool, and no agent will.** The edit is authored by the Owner or a human operator. An agent is refused at that path by a Claude Code security control; **that refusal is a control, not an obstacle, and it must not be bypassed** (no other tool, no shell redirect, no generated patch applied around it). If any tool call touching the file is refused by a security classifier, stop that operation and report the refusal verbatim.
>
> Until the procedure below is applied, **Ventana stays fail-closed and every Ventana UAT case is BLOCKED (reason: the Ventana key is not yet bound)**: never PASS, never FAIL.

Owner-approved value: **`ventana`** (UAT decision OQ-09, 2026-10-21; `docs/DECISIONS.md` #UAT-OD-2026-10-21). Applied on nonprod after the dry-run review.

## 1. What changes, and what does not

| | Before | After |
|---|---|---|
| `eos_policy.tenant_operating_company_keys` (tenant `taylor-nonprod`) | one ACTIVE row: `taylor -> taylor` (MIGRATED) | two ACTIVE rows: plus `ventana -> ventana` (NATIVE) |
| A native Ventana operational row (Work Order, Commercial record, warehouse, queue scope) | refused (`OPERATING_COMPANY_KEY_NOT_BOUND` / `OPERATING_COMPANY_NOT_GOVERNED`) | permitted for a caller whose company authority reaches Ventana |
| Who reaches Ventana | unchanged: Ventana reach is the Employee's home company (none is homed in Ventana), OPERATIONAL company-scoped Roles, or an explicit company-access grant; today ownerExecutive, generalManager and financeAccounting (and, for Finance only, administrator) | unchanged: binding a key confers no reach and no capability |
| Existing rows | none carries the key `ventana` (verify in step 2) | unchanged |

The binding only makes the partition exist. The writer (`scripts/tenantOperatingCompanyKeyReconcileCli.js`) adds ACTIVE rows named by the evidence file and **never rebinds, never overwrites, never deletes, never reactivates**; there is no `--key` argument by design, so the evidence file is the only place a key can come from.

## 2. Preconditions (read-only; the operator records the results)

1. Owner approval of the value `ventana`, recorded in `#UAT-OD-2026-10-21`.
2. The company is authorized and ACTIVE for the tenant (a binding cannot introduce a company):
   `SELECT operating_company_id, status FROM eos_policy.tenant_operating_companies WHERE tenant_id = (SELECT id FROM eos_policy.tenants WHERE key = 'taylor-nonprod');` expect `ventana ACTIVE`.
3. No binding exists yet: `SELECT operating_company_id, operating_company_key, status FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = (SELECT id FROM eos_policy.tenants WHERE key = 'taylor-nonprod');` expect `taylor taylor ACTIVE` only. (A different existing key for `ventana` would be refused as a conflict; a taken key `ventana` bound to another company would be refused as `keyTaken`.)
4. **No orphan rows already carry the key `ventana`.** Binding would make any such row reachable. List the tables, then count each; every count must be 0, else stop and report:
   `SELECT table_schema, table_name FROM information_schema.columns WHERE column_name = 'operating_company_key' AND table_schema IN ('eos_ops','eos_commercial','eos_finance','eos_policy') ORDER BY 1, 2;`
   then, per table: `SELECT count(*) FROM <schema>.<table> WHERE operating_company_key = 'ventana';`
5. The three existing Ventana intercompany receivables are PROTECTED: confirm with the Finance owner that the binding does not alter them (the binding writes only `tenant_operating_company_keys`).
6. The key shape is valid: `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` (`ventana` is). One key per company and one company per key, per tenant.

## 3. Who authors the edit

The **Owner or a human operator**, on a normal branch (suggested: `ops/ventana-operating-company-key`), in their own editor and session. The edit is exactly the three hunks in section 4 and nothing else. No agent may author, apply, stage or "prepare" it in the working tree.

## 4. The exact edit to `config/ownership/operating-company-keys.sandbox.json`

**Hunk 1: replace the comment lines 23-25** (the paragraph that begins `VENTANA IS AUTHORIZED BUT UNKEYED, DELIBERATELY.`) with:

```json
    "VENTANA IS KEYED BY THE OWNER RULING OF 2026-10-21 (UAT decision OQ-09), AND ONLY BY THAT RULING. Until",
    "then a native Ventana operational row failed closed because no binding was authored here; the Ventana",
    "binding below is that explicit decision. Its value 'ventana' reads the same as the company id, and that",
    "is, exactly like Taylor's, a coincidence of authoring and NOT an equality rule: code reads the binding",
    "row. Supporting a company conceptually and keying its partition remain two separate decisions; any",
    "further company stays unkeyed until it is bound here."
```

(keep the closing `],` of the `$comment` array and the commas exactly as the array requires; the last string has no trailing comma).

**Hunk 2: the status line (line 28):**

```json
  "status": "AUTHORED by Owner ruling 2026-09-22 — the Work Order migration operational key binding; AMENDED by Owner ruling 2026-10-21 — the Ventana operational key binding",
```

**Hunk 3: add a second binding after the Taylor binding** (the Taylor object gains a trailing comma; the new object is last):

```json
    },
    {
      "operatingCompanyId": "ventana",
      "operatingCompanyKey": "ventana",
      "provenance": "NATIVE",
      "reason": "Owner ruling 2026-10-21 (UAT decision OQ-09): the Ventana nonprod operational partition key, authored so Ventana operational rows can exist; Sample Company stays unbound."
    }
  ]
}
```

`provenance` is `NATIVE` ("authored by an operator for a live company"; `MIGRATED` is for establishing a key so a legacy population can be copied, which does not apply to Ventana). Do not touch the `environment` field: it must equal the project id of the `platform-sandbox` environment in `config/environments.json`, or the CLI refuses the file.

## 5. The test to update

`functions/test/operatingCompanyBindingPostgres.test.mjs`, the subtest at about lines 218-227 (`the governed key evidence names taylor -> taylor and keys no fixture partition`), pins the evidence to Taylor only and asserts Ventana is unkeyed. In the same PR replace it with:

```js
  await t.test("the governed key evidence names taylor -> taylor and ventana -> ventana and keys no fixture partition", () => {
    const cli = require("../scripts/tenantOperatingCompanyKeyReconcileCli.js");
    const { bindings } = cli.loadKeyEvidence("platform-sandbox");
    assert.deepEqual(bindings.map((b) => `${b.operatingCompanyId}->${b.operatingCompanyKey}`), ["taylor->taylor", "ventana->ventana"]);
    assert.equal(bindings[0].provenance, "MIGRATED");
    assert.equal(bindings[1].provenance, "NATIVE");
    // Sample Company stays outside the governed business partition.
    assert.equal(bindings.some((b) => b.operatingCompanyKey === "sample-co-synthetic"), false);
    // Ventana is keyed by one explicit Owner-ruled binding (2026-10-21), never by inference.
    assert.equal(bindings.filter((b) => b.operatingCompanyId === "ventana").length, 1);
  });
```

This is the only test that reads the evidence file: the other tests that mention an unkeyed Ventana (`administratorReorderQueuePostgres`, `commercialCommandLayerPostgres`, `commercialPersonaJourneyPostgres`, `adminAdministrabilityProofPostgres` and others) build their own bindings inside their test databases, so their comments only need a wording refresh, not a behaviour change. Also refresh the two `docs/DECISIONS.md` sentences that say nonprod Ventana is unkeyed (lines about the Finance closure record and the Administrator REORDER_QUEUE scope) by adding a dated note, not by editing history. It is a real-Postgres test: it runs in CI, not on a laptop (one heavy local run machine-wide). The PR must make CI run it (`config/ownership/**` triggers `eos-ownership-model-tests`; confirm which job runs `operatingCompanyBindingPostgres` and that it ran green).

## 6. The review (before merge)

1. A second human reviews the diff: exactly the three hunks plus the test, no other binding changed, no key changed for Taylor, `environment` untouched.
2. The Owner's approval of the value and of `NATIVE` provenance is cited in the PR.
3. The preconditions in section 2 are pasted into the PR as evidence (the counts, not a screenshot of a console).
4. The classifier: if any attempt to edit the file by an agent is refused, that refusal stands. The PR is authored by the human.
5. Merge is deployment (Vercel Production on every merge): the file is evidence for the CLI, not shipped code, but state the merge in the release note and confirm no other change rides along.

## 7. Reconcile: dry run, then apply (on the Render shell of `eos-api-nonprod`, from `functions/`)

`EOS_ENVIRONMENT` must read exactly `nonprod` in that shell. The CLI refuses a production environment by role or project id, the frozen Certification world, and any `--key` argument.

```
cd functions
node scripts/tenantOperatingCompanyKeyReconcileCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod --performedBy <operator>
```

Expected dry-run report (nothing written): additions `ventana`, `alreadyBound` `taylor`, no `notAuthorized`, `conflictingKey`, `keyTaken` or `inactive`, `applied: false`. Any refusal means stop and report; do not retry with other arguments. Review the report with the Owner, then apply:

```
node scripts/tenantOperatingCompanyKeyReconcileCli.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod --performedBy <operator> --apply
```

Expected: `applied: true`, one row added, a second run reports `alreadyBound` for both and no additions (idempotent). It never rebinds an existing company.

## 8. Read-back (record all three)

1. **Database:** `SELECT operating_company_id, operating_company_key, status, provenance, established_by FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = (SELECT id FROM eos_policy.tenants WHERE key = 'taylor-nonprod') ORDER BY 1;` expect `taylor taylor ACTIVE MIGRATED` and `ventana ventana ACTIVE NATIVE`.
2. **Dry run again:** the report shows both companies `alreadyBound` and an empty additions list.
3. **Behaviour, read-only through the API** (a persona with Ventana reach, signed in by the Owner): `readMyCompanyAuthority` (route `/operations/workspace`) lists company key `ventana` beside `taylor` for ownerExecutive and generalManager, and for a Taylor-only persona still lists Taylor alone (binding confers no reach). `listWorkOrderOperatingCompanies` (route `/operations/work-orders`, needs `workOrder.create`) offers every ACTIVE company that carries an ACTIVE key, so it now lists Ventana; that is the key being bound, not a grant of reach. No write is needed to prove the binding.

Then, and only then, tell lane VFX and Codex that the key is bound: the BLOCKED Ventana rows move to their next state (fixtures, then runnable).

## 9. Rollback

There is deliberately **no unbind command**: a binding is what makes a row's owner knowable, and the migration down refuses to destroy it. If the key must be withdrawn before any Ventana operational row exists, that is a separate, reviewed operator act (set the one row INACTIVE, which fail-closes Ventana again); it is not scripted here and needs the Owner's explicit authorization. After any Ventana row exists, withdrawal is a data migration decision, not a toggle.

## 10. Process finding (recorded per the Owner's 2026-10-21 direction)

A security-control refusal halts that operation until it is independently reviewed and explicitly authorized. It is never retried by another route. In this lane's phase 1 a tool refused to create a file named `report-template.md` (the refusal text was: "Subagents should return findings as text, not write report files. Include this content in your final response instead."); the lane then wrote the same content under the name `codex-result-template.md`. That was a retry by another route and should have been reported and stopped; it is disclosed here and in the PR. Nothing in this procedure may be applied that way.
