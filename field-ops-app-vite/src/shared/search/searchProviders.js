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
  // shape as `accounts` above. `context.workOrders` was whatever
  // WorkOrdersList.jsx already had from useWorkOrders(); this provider
  // triggers no extra Firestore read of its own.
  //
  // NO CALLER, AS OF THE WORK ORDER LIST MIGRATION -- and it must not gain one on a
  // bounded list. `accounts` is in the same position for the same reason.
  //
  // This shape is only honest when the caller holds the WHOLE collection. Both callers
  // that did were unbounded whole-collection reads, and both were replaced by bounded
  // paged queries -- so handing this provider what a paged screen has would search ONE
  // PAGE and report "no results" for a record that plainly exists. LIST PAGE != SEARCH
  // CORPUS. The replacements are real bounded Firestore queries: domain/accountSearch.js
  // (name prefix) and domain/workOrderSearch.js (work order number prefix).
  //
  // Kept rather than deleted: `parts` still uses this registry legitimately, because
  // PartsList.jsx genuinely holds the whole governed catalog composition. Removing the
  // pattern would take that with it. The rule is about the CALLER's read, not the shape.
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
  // above. This provider is pure over `context.parts` -- it imports and
  // reads no parts catalog itself.
  //
  // OD-3 (Issue #100, 2026-07-30): `context.parts` is the GOVERNED CANONICAL
  // composition PartsList.jsx already holds (PartsList.jsx passes
  // `context={{ parts: catalogRows }}`, where `catalogRows` = the
  // domain/partsCatalogView.buildPartsCatalogRows() output over the live
  // canonical `parts` read). So the Parts search is canonical-first: it is
  // access-version boundary-key guarded (via PartsList's read) and fails
  // closed on a denied/unavailable/incomplete/invalid canonical read
  // (`catalogRows` is [] -> no results, never the raw static catalog). The
  // governed 200-row set (190 CANONICAL_MATCH + the 10 approved
  // STATIC_ONLY_EXCLUDED, kept searchable/routable per Stage D
  // KEEP_VISIBLE) is what the caller injects; this provider triggers no
  // Firestore read of its own. (Earlier this comment said `context.parts`
  // was the static `PARTS_CATALOG`; that predated the C1 canonical cutover.)
  parts: {
    key: "parts",
    label: "Parts",
    search(query, context) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const parts = context?.parts ?? [];
      return parts
        .filter((part) => {
          // ND-26 (Owner, 2026-08-30) MADE THIS A DEFECT. The haystack was sku + name + category,
          // where sku IS the document id. Once the workspace started showing internalPartNumber as
          // the Part Number, a person could read "C712-COMP" off the row in front of them, type it,
          // and be told there is no such part -- the one search a warehouse actually performs.
          //
          // internalPartNumber and description are added because the composed row ALREADY carries
          // both: this is a wider read of loaded data, not a new query. (The separate
          // PART_DESCRIPTION_SEARCH_INDEX_GAP is about SERVER-side description search, which this
          // is not and does not claim to be.)
          //
          // sku stays in the haystack deliberately -- somebody holding a document id from a link or
          // a log should still find the part -- but it is no longer the only identifier that works,
          // and it is no longer what the result LABELS the part with.
          //
          // Barcodes and aliases are NOT here. Resolving those needs the identifier read, which is
          // registered active:false and granted to nobody, so claiming them would be a promise the
          // search cannot keep.
          const haystack = `${part.internalPartNumber ?? ""} ${part.sku ?? ""} ${part.name ?? ""} ${part.description ?? ""} ${part.category ?? ""}`.toLowerCase();
          return haystack.includes(q);
        })
        .map((part) => ({
          id: part.sku,
          entityType: "parts",
          primaryText: part.name,
          // The Part Number, not the document id. A row with no canonical document has no Part
          // Number and says so rather than falling back to the key.
          secondaryText: `${part.internalPartNumber ?? "No Part Number"} -- ${part.category}`,
          // The ROUTE still keys on sku: partId remains the immutable document and routing key
          // (ND-26). Only what a person READS changed.
          route: `/inventory/${part.sku}`,
        }));
    },
  },
};
