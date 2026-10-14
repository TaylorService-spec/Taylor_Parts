import { PageHeader } from "../../shared/ui/primitives";
import FinancialPolicyWorkspace from "./FinancialPolicyWorkspace";
import FinanceConfiguration from "./FinanceConfiguration";

// Administration -> Company Setup -> Financial Policy (DECISIONS #232 Phase 2).
//
// THE ONE PLACE a company's accounting policy is prepared, approved and activated. Financials shows a read-only summary
// and links here; there is deliberately no second edit surface, because two places to change an accounting method is
// two places for them to disagree.
//
// ============================ THE SERVER IS THE BOUNDARY ============================
//
// Everything below the header is FinancialPolicyWorkspace, which reads and commands ONLY through the governed PostgreSQL
// Financial Policy operations on /operations/finance (functions/src/eosFinance/financialPolicy.ts). It holds no
// capability check of its own: the companies it lists, the actions it offers and the reasons it gives for the ones it
// does not are the server's answers (readMyFinancialPolicyAuthority, and `yourActions` on each version). This page used
// to gate on the Firebase-era `financialPolicy.profile.*` feed ids; it no longer reads them.
//
// THE LOCK IS NOT THIS SCREEN'S DOING. An ACTIVE or SUPERSEDED version is immutable in the server AND the database; a
// change is a governed revision -- a new draft through the same lifecycle. There is no control here that reverses a
// decision, and there is no administrator bypass: separation of duties binds the Owner and the Administrator too.
//
// ============================ FINANCE CONFIGURATION (DECISIONS #203) ============================
//
// Accounting destinations and payment terms, gated independently on finance.configuration.manage through /admin/policy.
// Unchanged: a refusal there is that server's answer, rendered in its own section.
export default function AdminFinancialPolicy({ financeApi = undefined, callApi = undefined }) {
  return (
    <div>
      <PageHeader
        title="Financial Policy"
        subtitle="Each operating company's accounting policy, prepared by its accounting team, approved by the Owner and activated on a stated date. An active policy is locked; a change is a new version."
      />

      <FinancialPolicyWorkspace {...(financeApi ? { financeApi } : {})} />

      <div className="fo-panel">
        <FinanceConfiguration {...(callApi ? { callApi } : {})} />
      </div>
    </div>
  );
}
