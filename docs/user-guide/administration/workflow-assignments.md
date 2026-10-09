# Workflow Assignments and Workflow Builder

Administration → Workflows opens **Workflow Assignments**. Choose a workflow to see the Security Roles assigned to each action. If you may change assignments, **View … employees** lists the employees holding that role for that action. It shows how many hold the role and how many the action actually applies to, and marks a holder whose assignment scope doesn't cover the action. Employees you aren't allowed to view are counted but not named. Role-holder scope is shown; appearing in that list does not guarantee an action on every record. Existing permissions, assignment scope, guards and Functional Role requirements still apply.

The role picker offers only the Security Roles that hold the action's required permission, because a binding never grants. If a Role already assigned to an action does not hold that permission, the page says so beside the action. Saving is refused until you remove that Role; the page never removes it for you.

The page offers saving only when EOS confirms you are allowed to make that change. Otherwise the assignments are shown read-only and the page names the permission you need. Workflow Builder does the same for publishing, activating, retiring, new drafts, starting records and moving records. If EOS cannot confirm your permissions, nothing is offered.

Use the role picker to add or remove roles, enter a recorded reason, and choose **Save Assignment Draft**. EOS validates the proposed assignments before saving. The page changes only Security Role bindings: it preserves the steps, transitions, required permissions, guards and Functional Roles.

Published versions cannot be edited. Saving creates a new draft; it does not publish or activate it, and existing records retain their version. The success message links to the saved draft in **Workflow Builder** for review and activation. The server checks the existing workflow editing/version permissions on every save. No assignment grants new business permissions.

**Workflow Builder** is a separate page reached through **Open Workflow Builder**. It contains definition authoring, validation details, versions, publishing/activation, record migration and history. Its Back link returns to Workflow Assignments. Unsaved edits require confirmation before switching workflows or leaving for the other page.

A workflow missing required permission mappings shows a concise setup message on Workflow Assignments. It cannot be edited there until prepared in the Builder. The administrator is not asked to repair technical definitions during the assignment task.

Both pages use the existing `/administration/workflows` route and its unchanged access gate. `?view=builder` selects the Builder page; workflow/version parameters preserve context. This is presentation navigation, not permission authority.
