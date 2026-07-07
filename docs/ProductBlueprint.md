# Product Blueprint

**Status:** Version 1 — living document, expected to evolve.
**Related:** [ProductVision.md](ProductVision.md) · [PlatformConstitution.md](PlatformConstitution.md) · [GuidingPrinciples.md](GuidingPrinciples.md)

This document defines the platform's approved business-domain navigation and business objects. It describes the target shape of the platform (Version 2+); for what is actually implemented today versus planned, see `docs/ROADMAP.md`'s Product Release Roadmap and `docs/SPRINT_STATUS.md`.

## Business-Domain Navigation

The platform's primary navigation is organized by business domain, not by technical module:

1. **Dashboard** — role-specific landing view; summarizes what needs attention.
2. **Customers** — accounts, contacts, sites/locations.
3. **Service** — jobs, work orders, scheduling, dispatch, field execution.
4. **Inventory** — stock, parts, consumption.
5. **Purchasing** — suppliers, purchase orders, replenishment.
6. **Financials** *(future)* — invoicing, billing, cost tracking.
7. **Reporting** — cross-domain analytics and operational intelligence.
8. **Administration** — configuration, roles, users.
9. **Sales / CRM** *(future)* — leads, opportunities, quoting.

Today's implementation organizes navigation around Work Orders/Jobs, Technicians, Dispatch, Inventory, and Operations (see `docs/architecture/SYSTEM_AUTHORITIES.md`'s "Navigation" row for the current, real navigation source of truth, `App.jsx`'s `NAV` array). This blueprint is the target domain structure those and future modules are expected to grow into and be re-organized under, not a description of what's already built.

## Business Objects

Core business objects the platform is organized around, spanning current and future domains:

- **Customer** — an organization or individual receiving service.
- **Site / Location** — a physical place service is performed.
- **Job / Work Order** — a unit of service work, with its own lifecycle (see `docs/architecture/ADR-002-work-order-engine.md` for the currently-implemented Work Order lifecycle).
- **Technician** — a person who performs field or warehouse work.
- **Part** — an inventoried item consumed or installed during service.
- **Warehouse / Stock Location** — a physical place inventory is stored.
- **Supplier** — a vendor the platform purchases parts from.
- **Purchase Order** — a request to a supplier for parts.
- **Invoice** *(future)* — a billing record tied to completed service.
- **Lead / Opportunity** *(future)* — a sales-pipeline record.

## Role-Based Navigation Philosophy

Navigation is filtered by role, not by a single fixed menu (see [PlatformConstitution.md](PlatformConstitution.md)'s "Role-Based Experiences" principle):

- A role sees the domains and business objects relevant to its job, not the entire platform surface.
- The same underlying business object (e.g. a Work Order) is presented differently depending on who's viewing it — a dispatcher sees assignment/queue context, a technician sees only their own assigned work, an administrator sees configuration and oversight.
- Adding a new domain or business object should extend this role-filtering model, not introduce a second, competing navigation system — see `docs/architecture/SYSTEM_AUTHORITIES.md`'s "Role-based screen access" row for how this is enforced today.
