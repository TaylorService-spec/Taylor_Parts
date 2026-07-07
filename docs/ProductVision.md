# Product Vision

**Status:** Version 1 — living document, expected to evolve.
**Related:** [PlatformConstitution.md](PlatformConstitution.md) · [PlatformCapabilityModel.md](PlatformCapabilityModel.md) · [DeploymentModeStrategy.md](DeploymentModeStrategy.md) · [PlatformOperatingModel.md](PlatformOperatingModel.md) · [ProductBlueprint.md](ProductBlueprint.md) · [GuidingPrinciples.md](GuidingPrinciples.md) · [MobileStrategy.md](MobileStrategy.md)

## Mission

Build a configurable **Enterprise Operations Platform** for service organizations — a single system that runs the operational core of a service business, rather than a point solution for one department.

## Long-Term Scope

**See [PlatformCapabilityModel.md](PlatformCapabilityModel.md) for how these domains translate into concrete, independently-maturing business capabilities**, each with a current and target maturity level. The list below is this document's domain-level summary; the capability model is the detailed, actionable breakdown.

The platform's long-term scope spans the following business domains:

- **Customers** — accounts, contacts, sites/locations, service history.
- **Service** — jobs, work orders, scheduling, dispatch, field execution.
- **Inventory** — stock, parts, consumption tracking.
- **Warehouse** — physical stock locations, transfers, reconciliation.
- **Purchasing** — suppliers, purchase orders, replenishment.
- **Reporting** — cross-domain analytics and operational intelligence.
- **Financials** *(future)* — invoicing, cost tracking, billing integration.
- **Sales / CRM** *(future)* — leads, opportunities, quoting.
- **Administration** — configuration, roles, users, tenant settings.
- **AI** — assistive and predictive capability layered across domains (e.g. recommendation/scoring engines already in place for dispatch).
- **Business Intelligence** — executive-level, cross-domain reporting and forecasting.

Not every domain is built today. This document describes the platform's intended eventual shape; [ProductBlueprint.md](ProductBlueprint.md) describes what's built now and what's planned per version, and [ROADMAP.md](ROADMAP.md) tracks version-by-version delivery.

## Multi-Tenant Principle

The platform is intended to support **multiple service companies through configuration, not hardcoding**. Business rules, navigation, and role structures should be designed so a new service organization can be onboarded by configuring the platform, not by forking or modifying its code. This principle governs how new features should be designed even while the platform currently serves a single organization — see [PlatformConstitution.md](PlatformConstitution.md)'s "Configurable Platform" principle for how this is enforced architecturally, and [DeploymentModeStrategy.md](DeploymentModeStrategy.md) for how this principle extends to deployment, tenancy, and integration.

## Why This Matters

Service organizations today typically stitch together multiple disconnected tools (dispatch software, inventory spreadsheets, separate purchasing systems, ad hoc reporting). This platform's premise is that operational data — customers, jobs, parts, purchases, and the people executing the work — is more valuable connected than siloed, and that a single configurable platform can serve organizations of varying size and complexity without a rewrite per customer.
