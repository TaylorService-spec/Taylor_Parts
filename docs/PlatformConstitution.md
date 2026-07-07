# Platform Constitution

**Status:** Version 1 — living document, expected to evolve.
**Related:** [ProductVision.md](ProductVision.md) · [ProductBlueprint.md](ProductBlueprint.md) · [GuidingPrinciples.md](GuidingPrinciples.md)

This document states the ten approved principles the platform is built on. These are constitutional in the sense that new features are expected to comply with them, not the other way around — see `docs/CLAUDE_CONTEXT.md`'s "Product Authorities" section for how this is enforced during implementation.

## 1. One Platform

There is one platform, not a collection of separately-maintained tools bolted together. Every business domain (Customers, Service, Inventory, Purchasing, etc. — see [ProductVision.md](ProductVision.md)) is a module of the same system, sharing the same identity, data, and navigation model.

## 2. One Source of Truth

Every business object has exactly one authoritative record. No domain maintains its own duplicate copy of another domain's data. This principle is already enforced architecturally today — see `docs/PROJECT_ARCHITECTURE.md`'s system-of-record rules and `docs/architecture/SYSTEM_AUTHORITIES.md`'s ownership table.

## 3. Business Domains

The platform is organized around real business domains (Customers, Service, Inventory, Warehouse, Purchasing, Reporting, Administration, and future Financials/Sales-CRM), not around technical layers or teams. A user should be able to reason about the platform in the same terms they reason about their business.

## 4. Platform Capabilities

Capabilities that cut across domains (search, reporting, notifications, AI/scoring, configuration) are built once as shared platform capabilities, not duplicated per domain.

## 5. Role-Based Experiences

Different roles (dispatcher, technician, warehouse staff, administrator, executive) see different, purpose-built experiences drawn from the same underlying data — not one generic UI trying to serve every role at once. The existing dispatcher/technician/admin split in the current implementation is the first instance of this principle.

## 6. Device-Appropriate Design

The right device for the job drives the experience: desktop for office/planning work, mobile for field/warehouse work. See [MobileStrategy.md](MobileStrategy.md) for how this is applied.

## 7. Actionable Information

Information the platform surfaces should support a decision or an action, not just display data. Dashboards and reports are built to answer "what should I do next," not only "what happened."

## 8. Reduce Friction

Every workflow is evaluated for unnecessary steps, clicks, re-entry, or context-switching. See [GuidingPrinciples.md](GuidingPrinciples.md) for the concrete UX principles this produces.

## 9. Configurable Platform

Business rules, navigation, and role structures are designed to be configured per organization, not hardcoded per customer. This is what makes the "one platform, multiple service companies" model in [ProductVision.md](ProductVision.md) possible. [DeploymentModeStrategy.md](DeploymentModeStrategy.md) extends this principle to deployment: how an instance is hosted, tenanted, and integrated.

## 10. Build for the Next Decade

Architectural and product decisions favor long-term durability over short-term convenience. A decision that is easy today but forecloses the platform's long-term scope (see [ProductVision.md](ProductVision.md)) should be reconsidered rather than accepted by default.
