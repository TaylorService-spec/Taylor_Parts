# Microsoft Dynamics 365 Field Service + Business Central

**Last researched:** 2026-08-16 · **By:** field-service-domain-researcher (round 1)

**Why this product first:** it is what the first prospect actually runs. Field Service for
service, Business Central for parts, inventory and financials.

> ## ⚠ CORRECTION TO EARLIER STRATEGIC ADVICE
>
> An earlier draft of this project's positioning claimed that **no off-the-shelf product would
> model two legal entities under one roof**, and treated that as the moat.
>
> **That claim is wrong.** Business Central genuinely supports multiple legal entities with
> separate books — at the **Essentials** tier, not even Premium — with up to 300 companies per
> environment at no extra per-company licence cost.
>
> The differentiator is real but **much narrower than claimed**. See §5.

---

## 1. What the native FS ↔ BC integration actually syncs

Two tiers, and the entity list differs sharply
([Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/business-central/admin-integrate-field-service)):

**Project integration (default — works on BC Essentials):** work order products/services →
project journal lines · projects/tasks → FS external projects · resources ↔ bookable resources ·
locations → warehouses (one-way).

**Project *and* Service integration (requires BC Premium):** service orders ↔ work orders incl.
status · service item lines ↔ work order incidents · items ↔ work order products · resources ↔
bookable resource bookings · service lines ↔ work order services · service order types ↔ work
order types · service items ↔ customer assets. Item availability is exposed via a **separate
virtual table**, not the sync mechanism.

## 2. What it does NOT sync — all quotable from Microsoft's own page

- **Cancelled work orders are never synchronised.** Microsoft's own words: *"N/A — Not
  synchronized. Manual alignment is needed for canceled work orders."*
- **Item availability is a live virtual-table lookup**, not persisted synced data — and only
  works if FS and BC are **in the same tenant**.
- **Service sync requires BC Premium.** Essentials customers get no service-order sync at all.
- **You cannot enable Service alone** — *"you can't enable only the service management
  integration."* Project sync is a mandatory bundled dependency.
- **Purchase orders, invoices, customers and price lists are not in the mapping table.** BC stays
  system-of-record for financial documents; FS pushes usage, BC generates the invoice. Setup
  explicitly instructs admins to disable FS price/cost calculation.
- **Sync latency is configurable** — it can fire only on work-order completion. **Inventory drift
  during an active job is a documented design choice, not a bug.**
- **Not standalone**: requires an existing Dataverse connection *and* a Dynamics 365 Sales
  integration configured first.

## 3. Maturity

Base integration GA **April 2024**; dedicated AppSource app GA **July 2024**
([azurecurve](https://www.azurecurve.co.uk/2024/07/new-functionality-in-microsoft-dynamics-365-business-central-2024-wave-1-install-field-service-integration-with-business-central-from-appsource/)).
Under two years in market. Pre-GA Dynamics Community threads answered *"there is no standard
solution as of now… it needs to be integrated using APIs or OData"* — true **until mid-2024**,
and a trap to cite without the timeline.

**Little post-GA practitioner commentary exists** — mostly partner-blog marketing *about* the
integration rather than operators reporting outcomes. That absence is itself a signal.

## 4. Licence prerequisites

Essentials **$80** / Premium **$110** per user/month — a **+$30/user/month** step purely to
unlock service sync (~+$360/user/year). Premium is licensed per user **per environment**, not
per company: one Premium user reaches up to **300 companies** in that environment at no extra
per-company cost
([Microsoft licensing](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/deployment/licensing)).

## 5. Intercompany — the corrected verdict

**BC does support multiple legal entities with separate books, at Essentials tier.** Each entity
is a separate *company* in a BC *environment*; intercompany document exchange runs through a
native **IC Inbox/Outbox**
([Microsoft Learn](https://learn.microsoft.com/en-ca/dynamics365/business-central/finance-consolidated-company-reporting)).

**What "supports it" actually means in practice — this is the defensible narrower claim:**

- **Manual chart-of-accounts mapping** — each company's COA must be mapped to a shared
  intercompany COA, in both directions. Real setup effort, not automatic.
- **Consolidation requires a separate dedicated consolidation company** that pulls in subsidiary
  balances. It is a **batch run, not a live combined view.**
- **Native reporting is company-scoped.** Cross-entity reporting needs the consolidation company
  or Power BI — there is no built-in combined dashboard.
- **Cross-environment companies** (e.g. different localizations) need the API method plus Azure
  app registration.
- **Transfer pricing is not native.** BC intercompany is document *replication* with mapped
  accounts, not a pricing engine.

**The strongest evidence for the gap is the market that exists to fill it:** Binary Stream's
**Multi-Entity Management** add-on markets automated due-to/due-from allocation and AI-assisted
balance matching *"before close"*
([Binary Stream](https://binarystream.com/multi-entity-management-in-microsoft-dynamics-365-going-beyond-the-business-central-core/)).
A mature paid add-on market is what basic native functionality looks like from the outside.

## 6. What this changes for us

**Stop saying** *"your two systems don't talk"* — the integration is real and reasonably deep.
**Stop saying** *"BC can't do two companies"* — it can, at Essentials.

**Start saying** — all citable from Microsoft's own documentation:

1. **Service sync requires Premium**, at +$30/user/month, and forces Project sync along with it.
2. **Cancelled work orders never sync.** Manual alignment, by Microsoft's own admission.
3. **Inventory is not real-time by default** — sync can be deferred to job completion.
4. **Intercompany is manual COA mapping, batch consolidation, no live combined view, and no
   transfer pricing.** That — not "they can't do it" — is the honest wedge.
5. **The integration is under two years old** with little independent production track record.

## 7. ASSUMPTIONS (unsourced — verify before acting)

- That the prospect does not currently have the integration enabled. Inferred from reported
  double-entry pain, not confirmed.
- That the prospect holds Essentials rather than Premium. Unconfirmed.
- Partner-blog themes (data-cleanliness prerequisites, inventory drift) are directionally
  consistent with Microsoft's documented sync options but were not pinned to a quotable URL.

## 8. What could NOT be determined

- No Reddit threads surfaced for this integration, positively or negatively. **Absence of
  evidence, not evidence of absence.**
- No Microsoft "known issues" page specific to the FS↔BC integration.
- No post-GA practitioner case studies describing production experience at scale.
- Administration cost specific to *this integration* versus BC/D365 administration generally.
