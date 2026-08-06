# User Guide

Plain-language, role-based guides to what you can do in Field Ops today. Each page covers one capability end-to-end: what it's for, who can use it, and the steps to do it. No code, no internal terminology you don't need.

New here? Start with **Getting started**, then jump to the section for the part of the job you do — you don't need to read the others.

## About the status tags

Every guide is tagged so you're never misled about what actually works:

- **live** — the feature works today; follow the steps and it does what it says.
- **demo-only** — a preview you can click through, but it runs in memory and saves nothing (it resets on reload).
- **not-yet-available** — the screen is built and you can walk through it, but it can't complete because the backend piece isn't deployed yet. The guide explains what's missing.

---

## Getting started

- [Sign in to Field Ops](getting-started/sign-in.md) — **live** — Sign in with your work email and password; covers the login form, error message, No access state, and demo banner.
- [Understand your landing screen](getting-started/your-landing-screen.md) — **live** — What you see after sign-in: the app frame plus the role-specific My Dashboard (live technician dashboard; placeholder for admin/dispatcher, who use Operations Dashboard).
- [Move around the app](getting-started/navigating-field-ops.md) — **live** — Using the top area tabs and sub-tabs, what each role sees, and an honest note that many sub-sections are not-yet-built placeholders.
- [Sign out of Field Ops](getting-started/sign-out.md) — **live** — Use the Logout button in the top-right to end your session, especially on shared devices.

## Work orders

- [Browse and find work orders](work-orders/browse-work-orders.md) — **live** — Filter the work order list by lifecycle group and search for a specific one (admin/dispatcher).
- [View a work order's details](work-orders/view-work-order-details.md) — **live** — Open one work order to see customer, location, timestamps, parts, and history (admin/dispatcher).
- [Create a work order](work-orders/create-work-order.md) — **not-yet-available** — Four-step wizard that fills in fine but can't save yet — the createWorkOrder Cloud Function is undeployed.
- [Move a work order through its lifecycle (dispatcher)](work-orders/move-work-order-through-lifecycle-dispatcher.md) — **not-yet-available** — Mark Ready/Schedule/Dispatch/Close/Cancel buttons exist but transitionWorkOrder is undeployed, so status changes can't record.
- [Progress your assigned work order (technician)](work-orders/progress-assigned-work-order-technician.md) — **not-yet-available** — Accept/Travel/Arrive/Start Work/Complete on My Dashboard; same undeployed transitionWorkOrder callable, so steps can't record.

## Dispatch

- [Assign a job to a technician (Dispatch screen)](dispatch/assign-a-job-on-the-dispatch-screen.md) — **live** — One-click assign an unassigned job to an available technician from the Service > Dispatch cards.
- [Dispatch a Work Order (Dispatcher Board)](dispatch/dispatch-a-work-order-on-the-dispatcher-board.md) — **live** — Review the Work Order queue with technician recommendations and dispatch a SCHEDULED Work Order by picker or drag-and-drop.
- [Monitor operations (Control Tower)](dispatch/monitor-operations-in-control-tower.md) — **live** — Read-only operational overview: live counters, technician load, at-risk items, and a recommended dispatch queue.

## Technician (field)

- [See my assigned work orders](technician-field/see-my-work-orders.md) — **live** — Technician home dashboard: assigned work orders grouped by stage (Ready to Start / In Progress / Waiting / Completed Today) plus a performance snapshot.
- [Update a work order's status](technician-field/update-work-order-status.md) — **live** — Move an assigned work order through its lifecycle (Accept, Start Travel, Arrived, Start Work, Complete) from the work order detail view.
- [Record parts used and work notes](technician-field/record-parts-and-notes.md) — **live** — Adjust used quantities on planned parts and add append-only work notes via Execution Capture on an assigned work order.
- [Parts Scanner (Technician Workspace)](technician-field/parts-scanner.md) — **demo (except Receive)** — Field part scan/lookup at Service > Technician Workspace; in-memory demo except the real governed **Receive a purchase order** action — see [Receive a purchase order](inventory/receive-a-purchase-order.md).

## Inventory

- [Find a part and check its stock](inventory/find-a-part.md) — **live** — Look up a part in the Parts catalog and read its stock position and reorder status (read-only).
- [Request a reorder for a part](inventory/request-a-reorder.md) — **live** — Flag a low part into the reorder queue via the Request Reorder control (one-click for forecastable parts; eligibility-gated manual qty for Needs Planning).
- [Review a reorder request (approve or reject)](inventory/review-a-reorder-request.md) — **live** — Approve a pending request to hand it to the Parts Manager, or reject it with a required reason.
- [Assign a reorder request to a Parts Associate](inventory/assign-a-reorder-request.md) — **live** — Assign an approved request to a Parts-Associate-role employee via the employee picker.
- [Place the order and track purchasing](inventory/place-the-order.md) — **live** — Assignee-only: start purchasing, post progress updates, and record the purchase order (moves request to Ordered).
- [Mark a reorder request received](inventory/mark-reorder-received.md) — **live** — Assignee-only closeout of an Ordered request; explicitly marked as NOT updating stock counts.
- [View inventory transfers](inventory/view-transfers.md) — **live** — Read-only Inventory > Transfers workspace: part, From → To locations, and status, filterable by Active/In transit/Completed/Cancelled/All (admin/dispatcher).
- [View warehouses](inventory/view-warehouses.md) — **live** — Read-only Inventory > Warehouses workspace: name, Active/Inactive status, and receiving eligibility, filterable by All/Active/Inactive, with a summary count (admin/dispatcher).
- [Receive a purchase order](inventory/receive-a-purchase-order.md) — **real, fail-closed until activated** — The governed receipt: receive an Ordered purchase order into a warehouse. One workflow, two launch points — the **Inventory > Receiving** workspace (Admin/Dispatcher) or the Parts Scanner's "Receive a purchase order" action; currently fail-closed ("Receiving not available") until receiving is activated.
- [Cancel or void a reorder request](inventory/cancel-or-void-a-reorder.md) — **live** — Reason-then-confirm flow: cancel before ordering (admin/dispatcher) or void after ordering (assignee only); nothing deleted.
- [Log an inventory action (receive, adjust, or correct)](inventory/log-an-inventory-action.md) — **live** — Record a Receive/Adjust/Correct audit note against a part; explicitly log-only and does not change stock.
- [Parts scanner (Technician Workspace)](inventory/parts-scanner.md) — **demo (except Receive)** — Mobile scan-and-act preview (use/load/count/PO draft are in-memory demo); its **Receive a purchase order** action is the real governed receipt — see [Receive a purchase order](inventory/receive-a-purchase-order.md).

## Purchasing

- [View purchase orders](purchasing/view-purchase-orders.md) — **live** — Read-only Purchasing > Purchase Orders list of orders placed against reorder requests, filterable by Open/Received/Voided/All (admin/dispatcher).

## Accounts & customers

- [Browse and search customers](accounts-customers/browse-and-search-customers.md) — **live** — View the customer list, search by name, and open a record.
- [Add a new customer](accounts-customers/add-a-new-customer.md) — **live** — Create a customer via the + New Customer form.
- [View a customer's record](accounts-customers/view-a-customer-record.md) — **live** — Tour the six sections of a customer detail page.
- [Edit a customer](accounts-customers/edit-a-customer.md) — **live** — Change name, status, address, notes, tags, or external IDs.
- [Add a contact to a customer](accounts-customers/add-a-contact-to-a-customer.md) — **live** — Record a contact person with phone, email, and primary flag.
- [Add a location to a customer](accounts-customers/add-a-location-to-a-customer.md) — **live** — Record a customer site with address and access notes.
- [See a customer's work orders and activity](accounts-customers/see-customer-work-orders-and-activity.md) — **live** — Read Completed/Open counts and the Account Activity timeline.
- [Financial summary](accounts-customers/financial-summary.md) — **not-yet-available** — Section exists but shows "Sales data source not connected." — no provider wired.

## Administration

- [Add and view employees](administration/manage-employees.md) — **live** — List field technicians and add a new one (name + phone) on the Administration > Employees screen.
- [Read the integrations connection guide](administration/integrations-guide.md) — **live** — Browse and search the Administration > Integrations FAQ and gather a readiness checklist before requesting a connection.

---

## Related references

- [Reorder Requests (consolidated overview)](reorder-requests.md) — the end-to-end reorder story in one page, for Dispatchers, Parts Managers, Parts Associates, and Warehouse Managers. The per-step guides under **Inventory** above cover the same flow in detail.
- [Read the integrations connection guide](administration/integrations-guide.md) — how to prepare for, review, request, and support an infrastructure/integration connection (Administration → Integrations).

More pages are added as each capability ships. If a page you need doesn't exist yet, ask — it means it hasn't been written yet, not that the feature doesn't exist.
