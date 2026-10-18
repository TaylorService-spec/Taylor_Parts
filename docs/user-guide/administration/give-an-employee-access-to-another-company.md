# Give an Employee access to another company

**What this lets you do:** let a person see and act on another company's records, for example a Taylor Employee who also covers Ventana. This is called **company access**.

**What it does not do:**
- It gives **no permissions**. What the person may do in that company is still decided by the Security Roles they hold. A person with no returns permission still cannot record a return, in any company.
- It does **not** give Finance access to the company. Finance access is its own assignment (see [Give someone Finance access to a company](give-finance-access-to-a-company.md)).
- It does **not** change the person's own company on their Employee record, and it is not employment in the other company.

**Who can do it:** an Administrator or Owner (permission *Assign Role*). You cannot give company access to your own Employee record; ask another Administrator.

**Where:** Administration → Employees & Users → the person → **Roles & Access** → **Company Access**.

## Add company access

1. Under **Add company access**, choose the company. Only companies you can grant are listed: active companies in your organization, other than the person's own company and ones they already have.
2. Optional: set **Starts** and **Ends**. Leave them blank for access that starts now and has no end date. Dates are checked by the server. An end date must be in the future.
3. Type a **Reason**. It is required and is recorded in the audit history.
4. Choose **Preview impact**. EOS shows who is affected: the person gains the company, and nothing else changes.
5. Choose **Add Company Access**.

The person sees the company on their next request. They do not need to sign out.

## Remove company access

1. Choose **Remove** on the row.
2. Type a **Reason** and **Preview impact**.
3. Choose **Confirm Removal**.

Removal, and an end date passing, take effect on the person's next request. Removed and ended access stays in **Past company access** so the history is kept. If a grant has passed its end date but was never removed, it shows as *Expired* and no longer gives access; remove it before granting the same company again.

## If EOS refuses

The message names the reason. The common ones:

| Message | Meaning |
|---|---|
| `SELF_ADMINISTRATION` | You cannot give company access to your own Employee record. |
| `COMPANY_IS_HOME` | That is the person's own company. |
| `SCOPE_VALUE_INVALID` | That is not an active company of your organization. |
| `COMPANY_GRANT_EXISTS` | The person already has active access to that company with different dates. Remove it first, then add it again. |
| `COMPANY_GRANT_WINDOW_INVALID` | The dates are not valid: the end must be after the start and in the future. |
| `REASON_REQUIRED` | A reason is required. |
| `STALE_PREVIEW` | Something changed since you previewed. Preview again. |

A person who has no sign-in linked to their Employee record, or whose employment is not active, gets nothing from company access until that is fixed. The section is only shown for an Employee with a linked sign-in.

## Related

- [Give someone Finance access to a company](give-finance-access-to-a-company.md)
- [Manage users](manage-employees.md)
- [Administration: Policy and Access](../../training/administration-policy-and-access.md)
