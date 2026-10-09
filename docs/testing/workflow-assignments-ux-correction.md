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
