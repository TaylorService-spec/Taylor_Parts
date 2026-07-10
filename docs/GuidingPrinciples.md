# Guiding Principles

**Status:** Version 1 — living document, expected to evolve.
**Related:** [ProductVision.md](ProductVision.md) · [PlatformConstitution.md](PlatformConstitution.md) · [ProductBlueprint.md](ProductBlueprint.md)

These are the concrete UX principles that follow from [PlatformConstitution.md](PlatformConstitution.md)'s "Reduce Friction" and "Actionable Information" principles. Where `docs/DEVELOPMENT_STANDARDS.md` governs *how code is built*, this document governs *how the product should feel to use*.

## Reduce Clicks

Every workflow should be evaluated for the minimum number of steps needed to complete it. A feature that adds steps without adding clarity or safety should be reconsidered.

## Every Major Business Object Has a Detail Page

Customers, Work Orders, Technicians, Parts, Suppliers, Purchase Orders, and every other major business object (see [ProductBlueprint.md](ProductBlueprint.md)) should have a single, canonical detail view a user can navigate to, link to, and return to — not information scattered only across list rows or modals.

## Search First

Users should be able to find any business object by searching for it, rather than only navigating through menus or filtered lists. Search is a platform capability (see [PlatformConstitution.md](PlatformConstitution.md)'s "Platform Capabilities" principle), not a per-domain feature to rebuild each time.

## Enter Data Once, Reuse Everywhere

Data entered in one part of the platform (e.g. a customer's address, a part's catalog details) should be available everywhere it's relevant, never re-entered by hand in a second place. This is the UX expression of [PlatformConstitution.md](PlatformConstitution.md)'s "One Source of Truth" principle.

## People Are Selected by Recognizable Identity, Never Technical Identifiers

When a workflow needs a person assigned to it, the person is chosen by recognizable identity — name, operational role, department, or other relevant business context — never by a Firebase UID or other technical identifier typed or pasted in by hand. Technical identity stays available behind the selection, where it belongs, for authorization and security enforcement; it is never the thing a user has to recognize or remember. This is the UX expression of `PROJECT_ARCHITECTURE.md`'s Person Assignment Platform Service Standard: one reusable picker pattern replaces feature-specific manual-ID entry everywhere a person assignment is needed, and every assignment preserves an immutable, human-readable display snapshot so historical records stay understandable in an audit later, even as the underlying identity resolves and changes over time.

## Information Should Be Actionable

Every report, dashboard, or list should help a user decide what to do next, not just present data for its own sake. Prefer surfacing "3 work orders waiting on parts" over a raw table a user has to interpret themselves.

## Complete Workflows From a Single Workspace Whenever Practical

A user completing a task (dispatching a job, receiving a purchase order, closing out a work order) should be able to do so without bouncing between unrelated screens, where the underlying data model allows it.

## UX Should Follow Business Processes

Screens and workflows should mirror how the business actually operates (e.g. the real sequence of dispatch → travel → arrival → work → completion), not be organized around convenient technical boundaries. See `docs/architecture/ADR-002-work-order-engine.md` for an example of a workflow modeled directly on the real operational process.
