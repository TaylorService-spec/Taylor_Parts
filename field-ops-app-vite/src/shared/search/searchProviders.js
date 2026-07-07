// Sprint 2.0.2 -- Global Search provider registry (design approved
// prior to this sprint's coding phase). GlobalSearch.jsx knows nothing
// about Accounts/Work Orders/Parts specifically -- it only knows how
// to call `search(query, context)` on whichever providers it's given
// and render the generic `{ id, entityType, primaryText, secondaryText,
// route }` result shape. Adding a new entity to search means adding a
// provider here, not changing GlobalSearch.jsx itself.
//
// `accounts` (Sprint 2.0.2), `workOrders` (Sprint 2.0.3), and `parts`
// (Sprint 2.1.1) are the providers implemented so far --
// contacts/locations/equipment/employees remain NOT registered, not
// stubbed, not scaffolded. Each would follow this same shape when its
// own sprint adds it.
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

  // Sprint 2.1.1 -- Inventory Domain Foundation. Same client-side-
  // filter-over-already-loaded-data shape as `accounts`/`workOrders`
  // above. `context.parts` is PARTS_CATALOG (data/partsCatalog.ts, a
  // static in-memory array, not a Firestore read) as PartsList.jsx
  // already has it; this provider triggers no Firestore read of its
  // own, new or otherwise.
  parts: {
    key: "parts",
    label: "Parts",
    search(query, context) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const parts = context?.parts ?? [];
      return parts
        .filter((part) => {
          const haystack = `${part.sku ?? ""} ${part.name ?? ""} ${part.category ?? ""}`.toLowerCase();
          return haystack.includes(q);
        })
        .map((part) => ({
          id: part.sku,
          entityType: "parts",
          primaryText: part.name,
          secondaryText: `${part.sku} -- ${part.category}`,
          route: `/inventory/${part.sku}`,
        }));
    },
  },
};
