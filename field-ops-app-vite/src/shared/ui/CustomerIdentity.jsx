import { CUSTOMER_IDENTITY } from "../../domain/fieldCurrentJob";

// ONE presentation of customer identity, shared by every Work Order surface.
//
// Three surfaces rendered `Customer: acct-harbor` -- an internal document id in the
// place a business name belongs. Personas across four missions reported it, and one
// consequence is concrete: the same Work Order read as "acct-harbor" on the Dashboard
// and "Harbor Grill Restaurant Group" in Technician Workspace, so the two screens
// looked like different customers.
//
// The four states come from domain/fieldCurrentJob.js's resolveCustomerIdentity() and
// must stay distinct -- that module's own rule is that "you may not see this" and
// "there is nothing here" must never blur. A raw id is a third failure: it blurs
// "resolved" itself, presenting an identifier as though it were a name.
//
// This component decides NOTHING about authority. Each surface supplies a resolver
// from ITS OWN governed path: technician surfaces via the F1 trusted
// WorkOrder-keyed projection (useWorkOrderFieldContext), dispatcher/admin surfaces
// via the canonical accounts read (useAccountNames). Same semantics, different
// authorized transport.
const LABEL = {
  [CUSTOMER_IDENTITY.NOT_AUTHORIZED]: "Customer name not available to your role",
  [CUSTOMER_IDENTITY.ABSENT]: "No customer on this Work Order",
  [CUSTOMER_IDENTITY.UNRESOLVED]: "Customer name could not be resolved",
};

/**
 * @param {{state: string, name: string|null, customerId: string|null}} identity
 *        the result of resolveCustomerIdentity()
 * @param {boolean} [showReference] when true, an unresolved/unauthorized row may
 *        additionally show the raw id as an explicitly-labelled REFERENCE -- never
 *        as the name. Off by default.
 */
export default function CustomerIdentity({ identity, showReference = false }) {
  if (!identity) return null;

  if (identity.state === CUSTOMER_IDENTITY.RESOLVED && identity.name) {
    return <span className="fo-customer-identity">{identity.name}</span>;
  }

  const label = LABEL[identity.state] ?? LABEL[CUSTOMER_IDENTITY.UNRESOLVED];
  const showsId = showReference && identity.customerId && identity.state !== CUSTOMER_IDENTITY.ABSENT;

  return (
    <span className={`fo-customer-identity fo-customer-identity--${String(identity.state).toLowerCase()}`}>
      <span className="fo-muted">{label}</span>
      {showsId && (
        // Labelled as a reference so it can be quoted in a support call, and can
        // never be mistaken for the customer's name.
        <span className="fo-customer-identity__ref fo-muted"> (reference: {identity.customerId})</span>
      )}
    </span>
  );
}
