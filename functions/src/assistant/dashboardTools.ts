// DASHBOARD TOOLS. Thin wrappers over `AssistantBusinessDataReader` -- ADR-015 above the line.
//
// No `firebase-admin` import, no Firestore type, no collection name anywhere in this file. Each tool
// asks the storage-neutral reader for a business answer and shapes it for the model; it does not know
// or care what is behind that reader today.
//
// Built as a factory over an injected reader, not a module-level singleton: `execute` receives only
// `{ companyId, actorUid, record }` (the fixed `AssistantToolExecutionInput` contract every surface
// shares), so the reader has to arrive by closure at registration time, from the composition root --
// the same place that decides whether a real reader exists at all.
//
// ============================ ONLY TWO TOOLS, AND WHY ============================
//
// This file previously wired five. Owner review (#1855 authority-parity correction) found that three
// of them approximated an authority MyDashboard.jsx does not actually use:
//
//   dashboard.serviceAttention / dashboard.workOrdersByStatus -- MyDashboard gates these on
//     `isOperationsViewer` (role === "admin" || "dispatcher"), a legacy Rules-based check with NO
//     capability id at all. Gating the tool on `workOrder.transition` instead was a genuine widening:
//     a technician holds that capability too, and would have gained tenant-wide service-attention
//     reach the moment a reader is ever bound. There is no existing capability id that reproduces the
//     admin/dispatcher check, and inventing one here would be creating a new Work Order read
//     authority mid-PR -- explicitly out of scope. Moved to DASHBOARD_STARTER_GAPS.
//
//   dashboard.myGoals -- `performance.goal.read` authorizes GOAL TARGETS, never the metric ACTUAL
//     (performanceGoalClient.js: "the transport moves targets, never actuals"), and MyDashboard scopes
//     an individual goal by `employeeId`, which is NOT the same value as the EOS principal uid this
//     route resolves. Nothing in this PR can honestly map principalUid -> employeeId. Moved to
//     DASHBOARD_STARTER_GAPS rather than inventing that mapping or exposing an unauthorized actual.
//
// `dashboard.reorderQueue` and `dashboard.accountPortfolio` survive because their MyDashboard-governed
// authority is exactly one capability with no additional scope narrowing -- `reorder.request.read.queue`
// (Rules-backed, status-scoped, deliberately NOT location-scoped per governedBusinessRoles.ts's own
// R-32 comment) and `customer.record.read` (accountPortfolio's comment: "the capability alone") --
// which is exactly what each tool below requires and nothing more.
import type { AssistantTool, AssistantToolExecutionInput, AssistantToolResult } from "./assistantToolRegistry";
import type { AssistantBusinessDataReader, AssistantBusinessScope } from "./assistantBusinessDataReader";

function scopeOf(input: AssistantToolExecutionInput): AssistantBusinessScope {
  return { tenantId: input.companyId, principalUid: input.actorUid };
}

export function buildDashboardTools(reader: AssistantBusinessDataReader): readonly AssistantTool[] {
  return [
    {
      id: "dashboard.reorderQueue",
      surfaces: ["DASHBOARD"],
      description: "Pending reorder requests waiting for review, oldest first.",
      requires: ["reorder.request.read.queue"],
      deniedMessage: "You do not have visibility into the reorder queue.",
      async execute(input: AssistantToolExecutionInput): Promise<AssistantToolResult> {
        const items = await reader.getReorderQueuePreview(scopeOf(input), 10);
        return {
          toolId: "dashboard.reorderQueue",
          data: items,
          recordsAccessed: items.map((i) => ({ type: "reorderRequest", id: i.id })),
        };
      },
    },
    {
      id: "dashboard.accountPortfolio",
      surfaces: ["DASHBOARD"],
      description: "Account counts by status across the actor's governed customer scope.",
      requires: ["customer.record.read"],
      deniedMessage: "You do not have visibility into the account portfolio.",
      async execute(input: AssistantToolExecutionInput): Promise<AssistantToolResult> {
        const summary = await reader.getAccountPortfolioSummary(scopeOf(input));
        return { toolId: "dashboard.accountPortfolio", data: summary, recordsAccessed: [] };
      },
    },
  ];
}
