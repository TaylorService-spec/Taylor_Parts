# Give someone Finance access to a company without adding it to their everyday work

**What this lets you do:** let a person use Finance (payments, receivables, settlements) for a company that is not their own, without that company also appearing in the places they do everyday work: return intake, scheduling, the Work Order list, rental, and the Analysis and My Work figures.

**Who can do it:** an Administrator (permission *Edit Security Policy*). Assigning the Role to a person is a separate permission (*Assign Role*).

**Where:** Administration → Security Roles → pick the Role → **Edit Role Details**.

## The two settings

Every Security Role says what a *company assignment* of that Role gives. A company assignment is "this Role, for this company".

| Setting on the screen | What it does |
|---|---|
| **Company access for everyday work and Finance** (the default) | The person can work in that company, and use whatever Finance permissions the Role carries there. |
| **Finance access only** | The person can use the Role's Finance permissions in that company. The company is **not** added to the companies they work in. |

Nothing changes until you change it. Every Role starts on the default.

## Set a Role to Finance access only

1. Open **Edit Role Details** for the Role (for example *Financials Company Access*).
2. Under **What a company assignment of this Role gives**, choose **Finance access only**.
3. Type a **Reason for the change**. It is required, and it is recorded in the audit history with who made the change and the old and new setting.
4. Choose **Save Role**.

EOS refuses the change, and tells you why, when:
- the Role has no permissions yet;
- the Role has any permission that is not a Finance permission (for example it can also read Work Orders). Use the default for a Role like that, or split the Finance permissions into their own Role;
- the Role is protected (for example the Administrator).

After a Role is set to *Finance access only*, EOS also refuses to add a non-Finance permission to it. To add one, first set the Role back to the default.

## Give the person the company

Assign the Role to the person for the company, the way you assign any scoped Role (Administration → Employees & Users → the person → Security Roles, choose the company). Check the result in **Effective Access**: Finance should work at that company, and the person's list of companies for everyday work should be unchanged.

## Set it back

Choose **Company access for everyday work and Finance** and give a reason. You cannot widen a Role that you hold yourself; ask another Administrator.

## Related

- [Administration: Policy and Access](../../training/administration-policy-and-access.md)
- [Manage users](manage-employees.md)
