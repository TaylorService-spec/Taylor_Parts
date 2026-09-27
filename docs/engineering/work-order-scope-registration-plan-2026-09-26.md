# Work Order OPERATING_COMPANY scope: registration plan

Date: 2026-09-26. Lane: WR (Administration). Status: plan only. Nothing here is implemented.

## Why this exists

A company-scoped Security Role assignment (`scopeType: "operatingCompany"`) grants authority only for
capabilities listed in `SCOPE_EVALUABLE_GRANTS` (`functions/src/adminPolicy/assignmentScopeRuntime.ts`).
Today that list has one entry, `employee.record.read`. Because no `workOrder.*` capability is on it,
Administration refuses to scope a Role that carries only Work Order capabilities
(`SCOPE_NOT_EVALUABLE_FOR_ROLE`, proved in `workflowDomainReadinessPostgres` case 7). The result is that
an "Acme dispatcher who sees only Acme Work Orders" cannot be configured yet.

This plan lists the smallest set of changes that would make **`workOrder.record.read` × OPERATING_COMPANY**
real without breaking the rule "no configuration the runtime ignores". Under that rule, a registration
without a consuming gate site would be exactly the kind of inert configuration it forbids. So the
registration and its consumer have to land in the same change.

## 1. The registration

Add one entry to `SCOPE_EVALUABLE_GRANTS`:

```ts
Object.freeze({
  scopeType: "operatingCompany" as const,
  capabilityKey: "workOrder.record.read",
  consumers: Object.freeze(["eosOps.readWorkOrder", "eosOps.listWorkOrders"]),
}),
```

- `consumers` must name the new PostgreSQL read operations from §3. It must not name the Firestore
  callables. `getWorkOrderFieldContext` and `ai/workOrderContext` read Firestore and cannot supply a
  governed context.
- Nothing else in `assignmentScopeRuntime.ts` changes:
  - `holdingAdmits`, `admittedScopeValues` and `scopeEvaluableCapabilities` already work for any
    registered pair.
  - `ASSIGNMENT_SCOPE_DIMENSIONS.operatingCompany.contextKey` is already `operatingCompanyId`.
- `ADMINISTRATION_CAPABILITIES` is unaffected. `workOrder.record.read` is not an Administration key.
- Once registered, `assignRole(scopeType: "operatingCompany")` accepts a Role that carries
  `workOrder.record.read`. The engine's Pass 9 S5 binding admission (`transitionWorkflowInstance`) also
  starts admitting a scoped Role for a workflow action whose capability is `workOrder.record.read`. See
  §5 for why that is the only `workOrder.*` action it affects.

## 2. The stored governed fact that supplies the context

`eos_ops.work_orders.operating_company_key` is `NOT NULL` with a non-blank check (migration
`1761004800000_work-order-object-authority.sql`). This is a **key**, not a company id. Scope values and
`businessContext.operatingCompanyId` are governed **company ids** (`tenant_operating_companies`).
The mapping is:

```
eos_ops.work_orders.operating_company_key
  -> eos_policy.tenant_operating_company_keys (tenant_id, operating_company_key)   -- UNIQUE per tenant
  -> operating_company_id, only where b.status = 'ACTIVE' AND tenant_operating_companies.status = 'ACTIVE'
```

`eosOps/operatingCompanyBinding.resolveActiveOperatingCompanyId(client, tenantId, key)` already does
exactly this and fails closed (`OPERATING_COMPANY_KEY_REQUIRED` / `OPERATING_COMPANY_NOT_GOVERNED`).
Rules for using it:

- The context is always read **server-side from the stored row**, in the read transaction. It never
  comes from a request field.
- An unbound or inactive key is refused. It is never treated as "no context", and never mapped by
  reinterpreting the key as an id.
- A scoped holder is refused an out-of-scope Work Order with the **same** refusal a missing id gets
  (`WORK_ORDER_NOT_FOUND`), following the Pass 9 S7 precedent in `employeeReadKernel`. This removes
  any existence oracle.

## 3. Consumers that must supply `businessContext` server-side

No PostgreSQL Work Order read transport exists today. `eosOpsHttp` serves only capability and
experience context, and Work Order reads go through Firestore. The registration therefore depends on
building two reads, modelled on `eosWorkforce/reads/employeeReadKernel.runEmployeeRead` with
`recordScope: "operatingCompany"`:

| Consumer (new) | Decision | Context |
|---|---|---|
| `eosOps.readWorkOrder { workOrderId }` | `authorizeEntitledAction(reader, { actor, capabilityKey: "workOrder.record.read", recordId, businessContext })`: global flat holders unchanged; the `RECORD_ASSIGNMENT` condition still applies per record | `{ operatingCompanyId }` resolved from the row's `operating_company_key` via §2 |
| `eosOps.listWorkOrders { filters }` | Global holders see all rows. A scoped-only holder's reach is `admittedScopeValues(scopedHeld, "workOrder.record.read", "operatingCompany")`, the **unconditional** holdings only | SQL filter, §4 |

Existing PostgreSQL Work Order commands (`workOrderLifecycle`, `workOrderAssignmentAuthority`,
`workOrderPartsPlanAuthority`, `workOrderCreateCommand`) gate on **other** capabilities. They stay
flat-set gated and **must not** start honouring a scoped `workOrder.record.read`. Their capabilities
are not registered (§5).

The workflow engine consumer already exists. A domain transport calling
`transitionWorkflowInstance(..., businessContext)` must pass the §2 context read from the stored Work
Order. `workflowDomainReadinessPostgres` does this today for the Employee object (`storedEmployeeContext`).

## 4. List filtering in SQL

A scoped-only holder's list is filtered **in SQL**, never after the fetch. Filtering after the fetch
would leak counts and pagination:

```sql
SELECT w.*
  FROM eos_ops.work_orders w
  JOIN eos_policy.tenant_operating_company_keys b
    ON b.tenant_id = w.tenant_id AND b.operating_company_key = w.operating_company_key AND b.status = 'ACTIVE'
  JOIN eos_policy.tenant_operating_companies c
    ON c.tenant_id = b.tenant_id AND c.operating_company_id = b.operating_company_id AND c.status = 'ACTIVE'
 WHERE w.tenant_id = $1
   AND ($2::boolean OR b.operating_company_id = ANY($3::text[]))   -- $2 = global reach; $3 = admitted company ids
```

Rules for the filter:

- An empty `$3` with `$2 = false` returns zero rows. This is the fail-closed case and never means
  "no filter".
- A conditioned scoped holding (for example `RECORD_ASSIGNMENT` on the scoped grant) is **excluded**
  from list reach by `admittedScopeValues`, because a list cannot evaluate a per-record condition.
  That holder needs the global conditioned path, or gets no list.
- The intersection rule applies. If a list requires several deferred keys, reach is the intersection
  of their admitted companies (as `employeeReadKernel` does).

## 5. Other `workOrder.*` actions

| Capability | OPERATING_COMPANY? | Reason |
|---|---|---|
| `workOrder.record.read` | **Yes (this plan)** | The record read is the only Work Order gate that is already decided per record by the entitled evaluator (the `CONDITIONABLE_GRANTS` precedent). |
| `workOrder.transition`, `workOrder.lifecycle.dispatch/.cancel/.complete` | Later, one at a time | Each is gated by `authorizeLifecycleEdge` / `workOrderAssignmentAuthority` over the **flat** set. Registering one needs that gate to pass the stored row's context into `authorizeObjectAction` first. Otherwise a scoped holding is silently ignored by the command, or worse, a flat check admits it tenant-wide. Candidate order: `transition`, then `dispatch`, because "company dispatcher" is the named business need. |
| `workOrder.create` | Only with a stated company | The company is the command's input (governed context), not a stored row. Scope would be decided against the **requested** company after `resolveOperatingCompanyKeyForCompany`. This is a different consumer shape and needs its own ruling. |
| `workOrder.parts.plan` | No, not yet | Parts planning spans warehouse custody. A company scope without the location scope is not a meaningful boundary. |

## 6. Tests required with the change

1. **Unit** (`assignmentScopeRuntime.test.mjs`): the pinned `SCOPE_EVALUABLE_GRANTS` list gains exactly
   the one pair. `holdingAdmits` returns `ADMITTED` / `OUTSIDE_ASSIGNMENT_SCOPE` /
   `SCOPE_CONTEXT_REQUIRED` for `workOrder.record.read`. `scopeEvaluableCapabilities("operatingCompany")`
   has 2 entries.
2. **Administration** (`administrationScopeSecurityPostgres`, `assignmentScopeRuntimePostgres`): assigning a
   Role that carries only `workOrder.record.read` at `operatingCompany` now succeeds. A Role carrying
   only `workOrder.transition` is still refused `SCOPE_NOT_EVALUABLE_FOR_ROLE`. Invert
   `workflowDomainReadinessPostgres` case 7's finding to match.
3. **Read consumer (new PG suite)**:
   - in-scope read allowed
   - out-of-scope read gets `WORK_ORDER_NOT_FOUND`, identical to a missing id
   - no context gets `SCOPE_CONTEXT_REQUIRED`, never a pass
   - unbound or inactive `operating_company_key` is refused
   - list filtered in SQL: counts, pagination and `$3 = []` return zero rows
   - a global holder is unchanged
   - `RECORD_ASSIGNMENT` still narrows a global technician
4. **Parity** (`effectiveAccessExplanationPostgres`): `explainEffectiveAccess` shows `SCOPED` with
   `scopedSources` for the new pair. `listPrincipalWorkflowResponsibilities` shows a scoped binding on a
   `workOrder.record.read` action as `SCOPED` (the lane WR derivation already handles this generically).
   The three-way proof (`adminAdministrabilityProofPostgres` P3) keeps passing with a Work Order-scoped
   persona added.
5. **Negative**:
   - the lifecycle, assignment and parts-plan commands still refuse a scoped-only holder with
     `CAPABILITY_REQUIRED`
   - no Firestore callable is listed as a consumer
   - the capability-graph drift guard stays green
