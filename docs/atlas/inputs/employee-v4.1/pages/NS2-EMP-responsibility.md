# NS2-EMP — Employee Work & Responsibility Experience
Source: Owner design handoff "OWNERSHIP, ACCOUNTABILITY & ASSIGNMENT" (2026-09-13, verbatim in conversation). Consumes, never redefines: Employee Operating Model, Role/Responsibility Catalog, Proficiency Model, Ownership/Accountability/Assignment Model, Decision Authority Model, Work Type Catalog — semantic changes return to the operating-model workstream. Employee Operating Model DEFINED; runtime support not yet delivered (P2-G5: authority, persistence, commands, reads/projections, orchestration, person-state enforcement); designs render desired experience with honest states.

## Id map (handoff → NS2)
| NS2 id | DES-EMP | Surface |
|---|---|---|
| NS2-EMP-01 | 01 | Employee work queues (My Work: owned / accountable / assigned / approvals / escalations) |
| NS2-EMP-02 | 02 | Record responsibility context block (pattern, embeds in every record) |
| NS2-EMP-03 | 03+04 | Responsibility transfer + work reassignment (two distinct governed actions) |
| NS2-EMP-04 | 05+12 | Ownership transfer (retail & national accounts; history + future-records consequence) |
| NS2-EMP-05 | 06 | Employee operating profile (operational, not HR résumé) |
| NS2-EMP-06 | 07 | Workforce recommendation experience (explainable; recommendation ≠ decision) |
| NS2-EMP-07 | 08+09 | Manager responsibility view + responsibility exceptions |
| NS2-EMP-08 | 10 | Mobile field responsibility experience |
| NS2-EMP-09 | 11 | Responsibility history / audit |
| NS2-EMP-05a | 06 A–P | Employee Operating Profile — full section spec (identity/org, multi job roles, business responsibilities incl. primary/backup/contributing, proficiencies P0–P4 with required-vs-actual, evidence sources, qualifications, specializations, decision authority, capability summary + User Access link, owned/accountable/assigned/approvals/escalations, availability, development) |
| NS2-EMP-10 | — | User Access page: employee linkage only (never merged with profile) |
| NS2-EMP-11 | — | Responsibility Coverage (org coverage: primary/backup per critical responsibility — distinct from active-work accountability) |
| NS2-EMP-12 | 13 | Profile data collection & validation (self-declared / manager-validated / administrative / EOS-derived suggested evidence) |
| NS2-EMP-13 | — | Administration → People family (Employees, Job Roles, Responsibilities, Proficiencies, Qualifications, Decision Authority, Coverage, User Access — structure is a usability hypothesis) |

## Profile workstream additions (Owner package 2026-09-13, "EMPLOYEE OPERATING PROFILE")
- Concept chain binding: USER IDENTITY → EMPLOYEE → JOB ROLE(S) → RESPONSIBILITIES → PROFICIENCIES → QUALIFICATIONS → DECISION AUTHORITY → EOS CAPABILITIES → CURRENT WORK. Employee ≠ User Access; an employee may exist with no login; linkage is one field + navigation, never a merge.
- Sales is TWO job roles: Retail Sales and National Accounts Sales — independently assignable, different responsibilities/authority/metrics. Never one generic Sales role.
- Proficiency levels P0–P4; REQUIRED vs ACTUAL visually distinct with MEETS / EXCEEDS / GAP / NOT REQUIRED verdicts; governed level distinct from self-declared and from evidence; EOS-derived facts are SUGGESTED EVIDENCE a manager validates — never automatic skill changes.
- Qualification ≠ proficiency ≠ authority ≠ capability; specializations (equipment/customer/work-type/vendor/geography) are context, not proficiencies.
- Defect vocabulary extended: + MULTIPLE ACCOUNTABLE PEOPLE, ACCOUNTABLE INACTIVE, ASSIGNMENT WITHOUT ACCOUNTABILITY, QUALIFICATION GAP, OPERATING COMPANY CONFLICT.
- Profile scenarios: technician / retail sales / national accounts / parts+purchasing hybrid / service manager (5 test profiles).

## Policy questions returned to the operating-model workstream (output 18 — design does not resolve)
- EMP-PQ1: When manager-validated and self-declared levels conflict, is the governed level always the manager's, or is there an adjudication step?
- EMP-PQ2: Can two people legitimately share accountability during a shift handover window, or is MULTIPLE ACCOUNTABLE PEOPLE always a defect with zero tolerance?
- EMP-PQ3: Does a pending accountability transfer expire (and after how long), and to whom does it fall back?
- EMP-PQ4: Are decision-authority thresholds (e.g. purchase approval $) per employee, per role, or both with employee overrides?
- EMP-PQ5: Territory/service-area: operational fact on the profile or an assignment-model concept?
- EMP-PQ6: Which qualifications legally block assignment when expired (vs advisory)?

## Semantic vocabulary (binding, from handoff §2/§14)
Five relationship categories, chip-coded everywhere: OWNED / ACCOUNTABLE / ASSIGNED / APPROVAL / ESCALATED. An item may carry several. Company-owned records (WO, PO, inventory, counts…) never show an employee as "owner" — Taylor owns the PO; Sarah is accountable; Mark is assigned (§6). One generic OWNER field and one undifferentiated MY WORK queue are named anti-patterns (§33).

## Key behaviors
- Transfer accountability ≠ reassign execution ≠ transfer ownership — three distinct actions, each governed (§9–§13). Transfer pends until accepted; current holder stays accountable; forced transfer is a visibly exceptional action.
- Approval keeps accountability where it was (§19); escalation does not transfer the item (§20).
- Recommendation vs decision visibly distinct (§16–§17): proficiency-grounded, explained, never auto-assigns.
- Responsibility defects are first-class attention (§18): NO ACCOUNTABLE PERSON, unavailable holder, pending transfer, overdue, assignment conflict, proficiency gap, authority block.
- Start-of-day answers (§3) fold into NS2-HOME-01 as the queue structure — the dashboard's WORK section becomes these five queues at family open.
- Lists/search gain Owner / Accountable To / Assigned To / Approval From / Escalated To / Operating Company columns+filters (§31, feeds LST-00).
- Notifications name what changed and what did not ("assignment changed; Maria remains accountable") (§30).

## Frames at r1 (NS2-EMP r1.dc.html)
NS2-EMP-01-1440 (My Work, five queues), NS2-EMP-02/03-1440 (WO record with responsibility context + pending transfer; scenarios 3/5/9), NS2-EMP-07-1440 (manager view + defects; scenarios 10/11), NS2-EMP-08-375 (technician). Remaining subareas (profile, ownership transfer, audit) at family open.

## Scenario coverage register (§34)
S1/S2 → EMP-04 (pending design) · S3/S4/S5 → EMP r1 frame 1b · S6 → FIN credit approval pattern + EMP-01 approvals · S7 → INV-04 count-lead accountability (design at CC disposition) · S8 → INV-05 custody (P2-G4) · S9 → frame 1b · S10/S11 → frame 1c · S12 → EMP-04/09 (pending design).

OBSERVED AGAINST: none — this family has no current-EOS authority yet; all capability claims are MISSING CAPABILITY by definition until the operating-model workstream delivers.
