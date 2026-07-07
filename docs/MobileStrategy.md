# Mobile Strategy

**Status:** Version 1 — living document, expected to evolve.
**Related:** [ProductVision.md](ProductVision.md) · [PlatformConstitution.md](PlatformConstitution.md)

This document describes the approved multi-experience strategy for how the platform is delivered across devices, following [PlatformConstitution.md](PlatformConstitution.md)'s "Device-Appropriate Design" principle.

## One Backend, Multiple Experiences

There is one backend and one data model (see `docs/PROJECT_ARCHITECTURE.md`). Different devices and roles get purpose-built front-end experiences drawn from that same backend — not separate systems that happen to share a name.

## Enterprise Desktop Platform

Office-based roles (dispatchers, administrators, planners) are served by a desktop-oriented experience suited to dense information, multi-panel views, and planning work. This is the experience the current implementation's Control Tower, Dispatcher Board, and Operations dashboard represent today.

## Technician Mobile Experience

Field technicians are served by a mobile-oriented experience scoped to their own assigned work: accepting jobs, navigating their day, and capturing execution data (parts used, notes) in the field. The current implementation's Technician Dashboard (see `docs/architecture/SYSTEM_AUTHORITIES.md`'s "Technician mobile/landing flow" row) is the first instance of this experience.

## Warehouse Mobile Experience

Warehouse staff are served by a mobile-oriented experience scoped to physical inventory tasks: receiving, put-away, transfers, and stock counts. This experience is planned, not yet built — see `docs/ROADMAP.md`'s Product Release Roadmap.

## Shared Barcode / QR Scanning Capability

Barcode/QR scanning is a shared platform capability (per [PlatformConstitution.md](PlatformConstitution.md)'s "Platform Capabilities" principle) used by both the Technician and Warehouse mobile experiences — parts, work orders, and stock locations are all expected to be identifiable by scan, not built as separate one-off scanning features per experience.

## PWA-First Approach

Mobile experiences are delivered as Progressive Web Apps rather than native mobile applications, prioritizing a single deployable codebase and avoiding app-store distribution overhead, while still supporting offline-capable, installable, device-appropriate use.

## Why This Matters

A single technician-in-the-field experience and a single warehouse-floor experience, both served by the same backend and platform capabilities, is what lets the platform grow into new device contexts (see [ProductVision.md](ProductVision.md)'s long-term scope) without forking the underlying system per device.
