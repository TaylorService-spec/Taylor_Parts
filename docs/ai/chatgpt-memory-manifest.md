# ChatGPT memory manifest

**Generated:** 2026-08-16  
**Status:** Audit manifest required by `docs/ai/ai-state-contract.md`.  
**Authority:** This file exposes what ChatGPT had retained privately. It is not a substitute for canonical product, architecture, roadmap, decision, release, or environment evidence.

## Adopted contract

ChatGPT adopts clauses 1–6 of `docs/ai/ai-state-contract.md`: project truth lives in the repo; private state is limited to working preferences and repo pointers; repo wins on conflict; memory is never evidence; this manifest is published; and status is staged `DESIGNED → IMPLEMENTED → MERGED → DEPLOYED → ACTIVATED → USER-VISIBLE → E2E VERIFIED`. Environment state comes from the environment itself, especially `/version.json`, not from a deploy command.

## PROMOTE — project directions found only in ChatGPT private context

These are the invisible facts the contract is intended to eliminate. They are **not binding project authority yet**. Promote them into the named canonical artifact before using them as project truth.

| ID | Durable direction | Learned | Class | Canonical destination |
|---|---|---|---|---|
| P1 | Sandbox is intended to become a fully functional, production-shaped copy and then the permanent staging/pre-production gate for future Production changes. Test records may differ; product authorities/implementations should not. | 2026-08-15/16 | **PROMOTE** | Deployment/environment architecture + `DECISIONS.md` |
| P2 | Dispatch mapping roadmap: Suggested Tech should later combine proximity and skills; auto-assignment is optional/later behind explicit control; Taylor's current GPS provider may be integrated or replaced; mapping/location may be an optional paid capability. | 2026-08-08 | **PROMOTE** | Capability register + Dispatch/mapping roadmap |
| P3 | Notification capability needs a deliberate product redesign/rethink rather than preservation of the earliest notification implementation. | 2026-08-15 | **PROMOTE** | UX/product roadmap |
| P4 | Desired platform capability: Salesforce/Dynamics-style configurable pages with admin drag/drop placement of fields/items plus a later governed workflow/automation builder. | 2026-08-15 | **PROMOTE** | Capability register / Configuration Studio roadmap |
| P5 | After capability convergence, navigation should be deliberately reduced and backed by a real persona “who sees what” permission/navigation design, rather than accumulated overlapping routes. | 2026-08-15 | **PROMOTE** | Navigation/access roadmap + persona authorization spec |

## IN REPO — private facts reduced to pointers

All items below must be re-verified from the referenced authority before acting.

| ID | Durable fact previously held | Learned | Class | Repo pointer |
|---|---|---|---|---|
| R1 | Taylor_Parts is the first deployment of the broader Enterprise Operations OS / multi-company product direction. | 2026-07/08 | **IN REPO** | Product Vision, Constitution, Blueprint |
| R2 | Application stack is React/Vite with Firebase/Firestore/Auth/Functions/Hosting. | 2026-07 | **IN REPO** | `docs/Architecture.md`, project architecture, Firebase integration docs |
| R3 | Product/governance/architecture artifacts in `docs/` are the durable authorities, with document classification defined by the docs index. | 2026-07/08 | **IN REPO** | `docs/README.md` |
| R4 | Repository, not chat/session memory, is the durable source of project truth. | recurring; ratified 2026-08-16 | **IN REPO** | `docs/ai/ai-state-contract.md` |
| R5 | Authorization uses the governed Enterprise Access model: trusted commands/reads, role/capability evaluation, limited claims/accessVersion, audit, and no client-direct permission authority. | 2026-07/08 | **IN REPO** | ADR-005 + access/system-authority docs |
| R6 | Taylor/Ventana LOB and transaction operating-company distinctions are intentional; operating company belongs to transactions rather than being a single Account identity. | 2026-08 | **IN REPO** | inventory-sales/LOB design + Sales-to-Cash spec |
| R7 | Admin is expected to have broad operational ability through the governed permission model, not through bypasses. | 2026-08 | **IN REPO** | Decisions + access model |
| R8 | `fieldops_wos` is canonical Work Order authority; legacy job data is not a competing model. | 2026-08 | **IN REPO** | ADR-002 + build blueprint/system authorities |
| R9 | Technician recommendation is recommendation-only; dispatcher decides. GPS/skills/auto-assignment are not assumptions of the initial engine. | 2026-07/08 | **IN REPO** | ADR-004. Broader mapping direction is P2 above. |
| R10 | Warehouse operation is scan-first and scanner actions must invoke canonical movement/Receiving/WO authorities rather than maintain a second stock truth. | 2026-08-15 | **IN REPO** | `docs/roadmaps/2026-08-15-owner-capability-additions.md` §16 |
| R11 | High-value serialized equipment may use hardware-neutral observation (UHF RFID, BLE, UWB, GPS, etc.); observation is evidence, not inventory authority. | 2026-08-15 | **IN REPO** | owner capability additions §17 |
| R12 | Enhanced tracking devices are reusable operational assets temporarily bound to Equipment and recovered/reused after delivery. | 2026-08-15 | **IN REPO** | owner capability additions §17 |
| R13 | Marketing is detachable/licensable and core CRM must work without native Marketing; external providers use a provider-neutral contract. | 2026-08-15 | **IN REPO** | owner capability additions §18 |
| R14 | Account workspace direction includes compact header/health, two-column composition, commercial/SO/service/AR context, Account Attention, and optional Marketing seam. | 2026-08-15 | **IN REPO** | owner capability additions CRM UX section |
| R15 | CRM notes/activity should be attributed history, not a single mutable notes blob; task/follow-up authority must not be fabricated. | 2026-08-15 | **IN REPO** | owner capability additions + CRM Activity docs/code |
| R16 | Opportunity lifecycle UX should use governed stage progression/chevrons and existing transition authority. | 2026-08-15 | **IN REPO** | owner capability additions + Opportunity authority |
| R17 | Cross-franchise Equipment receiving/install includes local custody/receiving/staging/install/service with selling-franchise/customer ownership and billing distinctions. | 2026-08 | **IN REPO** | `docs/business-processes/cross-franchise-equipment-receiving-installation.md` |
| R18 | Sales-to-Cash-to-Commission has explicit actor/SoD distinctions including Controller and Accounting. | 2026-08 | **IN REPO** | Sales-to-Cash specification + decisions |
| R19 | Parts is the primary operational inventory experience; Part Master is master-data/governance convergence rather than a competing operational Parts authority. | 2026-08-15 | **IN REPO** | Parts UX/ADR/nav convergence artifacts |
| R20 | Serialized Asset identity is distinct from installed Customer Equipment identity and must reuse canonical Receiving/ledger/movement authorities. | 2026-08 | **IN REPO** | ADR-010 + serialized-asset specs |
| R21 | Delivery/location changes depend on governed transfer/movement authority; tracking observations cannot substitute for custody/movement truth. | 2026-08-15 | **IN REPO** | owner capability additions explicit boundaries |
| R22 | Auto-publishing GitHub Pages from `main` is a known promotion-governance problem; target state requires governed non-production review and explicit Production promotion. | 2026-08 | **IN REPO** | `docs/design/pages-production-promotion-target-state.md` |
| R23 | Navigation is role-based; different personas may receive different presentations of the same underlying object. | 2026-07/08 | **IN REPO** | Product Blueprint + nav/access authorities |
| R24 | `platform-sandbox` / `eos-platform-sandbox` is the declared sandbox environment; exact live state must be read from the environment. | 2026-08 | **IN REPO** | `config/environments.json` + live `/version.json` |
| R25 | Hosting deployment is environment-aware and Functions should be deployed in smaller/domain batches after the Wave 7 deployment lesson. | 2026-08-16 | **IN REPO** | current Wave 7 deployment guidance/runbook |
| R26 | “Merged” is not “deployed,” and “deployed” is not “activated/visible/E2E verified.” | 2026-08-16 | **IN REPO** | AI state contract clause 6 + Wave 7 truth matrix |

## PREFERENCE — legitimate private Owner working preferences

| ID | Working preference | Learned | Class |
|---|---|---|---|
| W1 | Prefer concise, copy/paste-ready Claude Code handoffs/commands when execution is requested. | recurring | **PREFERENCE** |
| W2 | Verify repo state before recommendations; do not make the Owner reconcile unsupported claims between AIs. | recurring | **PREFERENCE** |
| W3 | ChatGPT is primarily useful as independent architecture/governance/product verifier/controller; Claude/agents are primary implementers. | recurring | **PREFERENCE** |
| W4 | Ask fewer unnecessary questions; proceed on established reversible direction and escalate genuine material/protected decisions. | 2026-08 | **PREFERENCE** |
| W5 | Minimize Owner relay/babysitting effort across multiple AI chats. | 2026-08 | **PREFERENCE** |
| W6 | Prefer coherent pooled sandbox promotions rather than avoidable deploy drift, subject to current repo runbooks. | 2026-08 | **PREFERENCE** |
| W7 | Do not create EOS/ChatGPT automations merely because recurring work exists; wait for explicit Owner direction. | 2026-08 | **PREFERENCE** |
| W8 | UX should be coherent, operationally useful, and non-generic; reduce duplicate cards/routes/surfaces around the user's actual job. | 2026-08 | **PREFERENCE** |

## STALE — prior private status/history that is no longer truth

| ID | Previously retained claim | Learned | Why stale | Class |
|---|---|---|---|---|
| S1 | Sandbox deployed baseline was `23fd5692`. | 2026-08-15 | Historical snapshot only; never use memory for current environment state. | **STALE** |
| S2 | Detailed Waves 3–6 / PR #970–#998 narrative represented current platform status. | 2026-08-15 | `main` advanced substantially; history only. | **STALE** |
| S3 | Early persona/capability snapshot such as “technician has 0 capabilities” represented current authorization. | 2026-08 | Authorization evolved; re-read current catalogs/roles/environment. | **STALE** |
| S4 | Part Master needed to remain normally visible to avoid stranding CRUD actions. | 2026-08-15 | CRUD later moved into Parts and Part Master became hidden/convergence work. | **STALE** |
| S5 | Manufacturer administration was simply blocked because reads were closed to every persona. | 2026-08-15 | Governed manufacturer read work later landed; blocker must be revalidated. | **STALE** |
| S6 | “Transfer Orders do not exist anywhere.” | 2026-08-15 | Later repo audit proved a real transfer read model/workspace exists; missing authority was the operating/write movement loop. | **STALE** |
| S7 | Available Equipment had to remain inert because no Serialized Asset registry existed. | pre-Wave-7 | Serialized Asset foundation later landed; current seam must be revalidated. | **STALE** |
| S8 | Serialized Asset Slice B was blocked on whether Receiving could accept `SERIAL`. | 2026-08-15 | Owner authorized it and Slice B later merged. | **STALE** |
| S9 | New Opportunity was necessarily an inert/disabled control. | 2026-08-15 | Governed create wiring later landed; live stage still requires evidence. | **STALE** |
| S10 | Full Dispatch/Scheduling redesign was absent from `main`. | 2026-08-15 | Completion package later merged the combined workspace. | **STALE** |
| S11 | Account-scoped Opportunity and Sales Order reads/sections were absent from `main`. | 2026-08-15 | Completion package later merged them. | **STALE** |
| S12 | `workOrder.parts.plan` and `crm.activity.*` were activated but ungrantable because no Role carried them. | 2026-08-16 | Grantable Roles were later merged; sandbox grant state remains separately evidenced. | **STALE** |
| S13 | Any remembered exact live Function/index count, Role grant, persona state, or deployed commit. | various | Volatile state: must be re-read from repo/runtime evidence. | **STALE** |

## Standing disposition

Going forward, ChatGPT will treat Taylor_Parts private context only as:

1. Owner working preferences; or
2. pointers back to repository authority.

Project status narratives, capability state, PR state, deployment state, environment state, and architectural facts are not private-memory authority. Any conflict is resolved in favor of the repository, and any live-environment claim requires live environment evidence.
