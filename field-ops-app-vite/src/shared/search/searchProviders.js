// Sprint 2.0.2 -- Global Search provider registry (design approved
// prior to this sprint's coding phase). GlobalSearch.jsx knows nothing
// about Accounts/Work Orders/Parts specifically -- it only knows how
// to call `search(query, context)` on whichever providers it's given
// and render the generic `{ id, entityType, primaryText, secondaryText,
// route }` result shape. Adding a new entity to search means adding a
// provider here, not changing GlobalSearch.jsx itself.
//
// `accounts` (Sprint 2.0.2) and `workOrders` (Sprint 2.0.3) are the
// only providers implemented so far -- contacts/locations/equipment/
// parts/employees remain NOT registered, not stubbed, not scaffolded.
// Each would follow this same shape when its own sprint adds it.
//
// `context` carries already-loaded data a provider needs, so a search
// never triggers its own extra Firestore read -- same client-side-
// filter-over-already-loaded-data pattern already used by
// DispatcherBoard.jsx's search. For `accounts`, that's the same
// `accounts` array AccountsList.jsx already has from
// useFirestoreCollection("accounts").
export const SEARCH_PROVIDERS = {
  accounts: {
    key: "accounts",
    label: "Customers",
    search(query, context) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const accounts = context?.accounts ?? [];
      return accounts
        .filter((account) => (account.name ?? "").toLowerCase().includes(q))
        .map((account) => ({
          id: account.id,
          entityType: "accounts",
          primaryText: account.name,
          secondaryText: account.status ?? "",
          route: `/customers/${account.id}`,
        }));
    },
  },

  // Sprint 2.0.3 -- same client-side-filter-over-already-loaded-data
  // shape as `accounts` above. `context.workOrders` is whatever
  // WorkOrdersList.jsx already has from useWorkOrders(); this provider
  // triggers no extra Firestore read of its own.
  workOrders: {
    key: "workOrders",
    label: "Work Orders",
    search(query, context) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const workOrders = context?.workOrders ?? [];
      return workOrders
        .filter((wo) => {
          const haystack = `${wo.woNumber ?? ""} ${wo.customerId ?? ""} ${wo.type ?? ""}`.toLowerCase();
          return haystack.includes(q);
        })
        .map((wo) => ({
          id: wo.id,
          entityType: "workOrders",
          primaryText: wo.woNumber ?? wo.id,
          secondaryText: `${wo.status ?? ""} -- ${wo.customerId ?? ""}`,
          route: `/service/work-orders/${wo.id}`,
        }));
    },
  },
};
