from ed import edit
R = "D:/eos-fb-exit/"
edit(R + "docs/DECISIONS.md", [
("""  - The EOS Account read is **tenant-scoped**. `eos_crm.accounts` carries no operating company (migration 1758758400000), so there is no company dimension to apply. The decision's "company-scoped per #235" therefore resolves to the Account's tenant-scoped predicate.
  - Create needs `crm.activity.create` and an Account in this tenant.""",
"""  - The EOS Account read is **tenant-scoped**. `eos_crm.accounts` carries no operating company (migration 1758758400000), so there is no company dimension to apply. No company scope is invented. Company-scoped Accounts are a separate model question for the Owner.
- **Create (Owner review, 2026-10-17).** Create needs `crm.activity.create` **and the same Account visibility** (`customer.record.read`, with the Account in this tenant).
  - Every linked Contact, Opportunity and Sales Order must exist **in this tenant and on that Account**.
  - A link outside the tenant, or on another Account, is refused exactly like an unknown one (`CONTACT_NOT_FOUND` / `OPPORTUNITY_NOT_FOUND` / `SALES_ORDER_NOT_FOUND`).
  - The Firestore command checked neither."""),
("""  - This is grant-bearing (Owner ruling E): the authority baseline goes 481 → 487 in the same change.
  - The read additionally requires `customer.record.read`. That narrows only a principal who could not open the Account at all, and admin and owner hold it.""",
"""  - This is grant-bearing (Owner ruling E): the authority baseline goes 481 → 487 in the same change.
  - **Explicit API restriction, not parity.** A principal holding `crmActivityContributor` ALONE, without `customer.record.read`, can no longer read or create activity through the API. That principal could reach the Firestore callables directly. That it could not open the Account page does not establish API parity, so this is stated as a restriction for Lane D's review.
  - Admin and owner hold `customer.record.read`. **No customer-read grant is added** to compensate."""),
])
edit(R + "docs/user-guide/accounts-customers/record-customer-activity-and-notes.md", [
("""- **Adding a note:** you need access to record CRM activity.""",
"""- **Adding a note:** you need access to record CRM activity *and* access to read the customer record."""),
("""- **"Please check the note and try again."** The note is empty or too long, or the time you entered is in the future.""",
"""- **"Please check the note and try again."** The note is empty or too long, or the time you entered is in the future.
- **"Could not save the note."** The note links a contact, opportunity or sales order that does not belong to this customer."""),
])
