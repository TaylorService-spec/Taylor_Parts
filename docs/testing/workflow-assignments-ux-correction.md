# Workflow review finding correction

Owner decision: October 8, 2026, America/Phoenix. Starting build: `34a7658b`.

**W01 — High: assignment task and workflow authoring share one long page.** The current page exposes lifecycle controls, validation diagnostics, states, actions, draft editing, instances and history in a single scroll. This obscures the primary administrator task: assigning prepared workflows to Security Roles and seeing role holders.

The correction is **two separate pages**, not a tabbed builder on the main page:

- Workflow Assignments is the default destination: choose workflow, review action/role assignments, inspect employees and prepare assignment changes with a reason.
- Workflow Builder is a separate linked page: author definitions, map required permissions, validate, version and activate.

The screenshot's 18 missing capability mappings are workflow setup findings, not an assignment-page responsibility. They must not be silently “fixed” by guessing permissions, widening grants or publishing invalid drafts.

Implementation preserves published-version immutability and all existing server authorization. Role-only changes are validated and saved as a new inactive draft. Existing records do not migrate automatically. The UI calls the resulting state an assignment draft, not a live assignment change.

Scope: this implements W01 and corrects the review interpretation. Other findings from the Administrator review remain separate work; no all-findings-complete claim is made. No deployment or live configuration changes are authorized by this implementation.

Local validation: 25 component tests and 18 contract/navigation tests passed; TypeScript checking, targeted Oxlint, production build and whitespace checks passed. The build retains existing chunk-size and AnalysisWorkspace import warnings. Rendered browser acceptance and multi-account visibility verification remain pending; these checks do not establish live visual acceptance.

Implementation is isolated on `fix/admin-workflow-assignments` for an Administration-only W01 PR. No merge, deployment or live configuration change is authorized. W01 is not closed against the deployed sandbox.

## Independent code review — October 9, 2026

A separate reviewer traced the assignment mutation calls through the server commands. Both `createWorkflowVersion` and `updateWorkflowDefinition` create a new DRAFT. Neither changes `activeVersionId`, published definitions, grants or existing workflow instances. The assignment page invokes no publication, activation, retirement, migration or grant command. Builder activation remains a distinct governed action; this is code-path evidence, not live-environment acceptance.

Three review findings were addressed: retain save confirmation after a no-active-workflow refresh; protect unsaved changes across global anchor navigation and reload; preserve legacy own-assignment guards defensively. Regression tests cover these cases. Browser Back/Forward within the SPA remains outside the scoped anchor/reload guard; a shared router blocker is separate work, not an authorization bypass.

Release gates: independent review of corrections, PR CI, then Owner decision on sandbox merge/deployment. Workflow Assignments must remain a straightforward administrative assignment screen; graph authoring, diagnostics and lifecycle controls belong only in Builder. Remaining Administration findings retain their original identities and status in the Administration review; this PR does not reconcile or complete the overall redesign.

## Rendered acceptance — October 9, 2026

Rendered in headless Edge against the real EOS API and the governed local authority (94 migrations / 128 capabilities / 542 grants) at head `2cdf8ab3`. The save path was exercised on a cloned database with a labelled local fixture, because under actual grants no Role holds a `workflowDefinition` write capability.

Defects found and corrected (W01 scope):

- **F1:** the page links (Open Workflow Builder, Back to Workflow Assignments, Review and activate, role-holder employee links) had no app base path, so they left an app served under `/Taylor_Parts/field-ops/` and landed on a blank page. They now carry the build-time base.
- **F2:** the chosen workflow was not in the address. After two choices, browser Back left Administration and reload lost the choice. The choice is now kept in `?workflow=` with `replaceState`, which adds no history entry and so no unguarded back step.
- **F4:** a refused validation said only "cannot be activated yet". It now states the server's reason, for example a Role bound to an action whose capability it does not hold ("a binding never grants").

Confirmed:

- Unsaved-change protection works on selection changes, page links (Keep Editing / Discard) and reload or full-page Back (browser prompt).
- Unauthorized principals see the honest refusal and make no workflow reads.
- Every save under actual grants is refused by the server (403), and nothing changes.
- With the fixture holder, a save on a published version creates a new inactive DRAFT. The published version stays active. Grants, direct grants, access versions, instances and the effective access of a bound Role's holder are all unchanged.

Open for Owner decision:

- No Role holds `workflowDefinition.edit` or `version`, and every action of all five workflows lacks a capability mapping. Assignment changes are therefore impossible in practice until the Owner rules on both.
- The Assignments page also needs `admin.securityPolicy.read` for its Security Role list.
- Builder shows lifecycle controls enabled to read-only holders; the server refuses them. This behaviour was carried over unchanged from the prior page.
