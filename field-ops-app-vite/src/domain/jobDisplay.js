// F-RULES-1 D3 blocker fix -- pure normalizer for the legacy fieldops_jobs
// `customer` field, which exists in TWO shapes in the wild:
//   - legacy string:        customer: "ACME Corp"
//   - object-shaped:        customer: { name: "ACME Corp" }
// (The object shape is what the governed test/smoke fixtures and newer
// tooling write; historical UI-created jobs carry plain strings.)
//
// Rendering the raw value crashed the production Technician Workspace with
// React error #31 ("Objects are not valid as a React child (found: object
// with keys {name})") when FieldMode met an object-shaped customer. Every
// customer DISPLAY in the technician flow must go through this helper --
// matching this codebase's "pure logic lives in domain/" pattern
// (actorDisplayName.js) so the plain-node test runner covers it.
export function jobCustomerName(customer) {
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && typeof customer.name === "string") {
    return customer.name;
  }
  return "";
}
