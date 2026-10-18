// WAREHOUSE RACKING ON EOS. Firebase exit B3 (DECISIONS #B3; Owner rulings 5-7).
//
//   browser -> THIS -> POST /admin/policy: listRackingWarehouses / listRackingBins / previewBinCreates / createBins / renameRackingBin /
//   setRackingBinStatus -> verified bearer -> EOS Principal + tenant + inventory.location.bin.read / .manage + the caller's operating
//   companies -> PostgreSQL eos_ops.bins + bin_code_claims (functions/src/eosOps/warehouseBinAdministration.ts)
//
// It has the SAME method surface as services/binCommandClient.js (the Firebase callables) so the Warehouse Racking screen is one component:
// listBins, previewBinCreates, renameBin, deactivateBin, reactivateBin -- plus `createBins`, the batch apply with PER-ITEM outcomes
// (CREATED / UNCHANGED / REFUSED, never one success flag). `requiresReason` tells the screen to collect the stated reason every Administration
// change carries. Which client the screen uses is decided ONCE at BUILD time by the F1 flag (AdminWarehouseRacking.jsx); there is no
// runtime fallback.
//
// It decides nothing: a refusal is the server's answer, thrown with its code so the screen renders a refusal and never an empty rack.
// The transport is imported LAZILY, on the first real call: adminPolicyApiClient.js initializes Firebase at import, and this module must stay
// importable -- and unit-testable -- without that.
const callPolicyApi = async (...args) => (await import("./adminPolicyApiClient.js")).callPolicyApi(...args);

function unwrap(res) {
  if (res?.ok === true) return res.data;
  throw Object.assign(new Error(res?.message || "The racking service could not complete that request."), { code: res?.code ?? "INTERNAL" });
}

/** @param {{ callApi?: typeof callPolicyApi }} [deps] injectable transport (tests) */
export function createEosRackingClient({ callApi = callPolicyApi } = {}) {
  const status = async (binId, next, reason) => unwrap(await callApi("setRackingBinStatus", { binId, status: next, ...(reason ? { reason } : {}) }));
  return Object.freeze({
    requiresReason: true,
    async listBins({ warehouseId }) {
      const data = unwrap(await callApi("listRackingBins", { warehouseId }));
      return { bins: data?.items ?? [], truncated: data?.truncated === true };
    },
    // The planner's rows carry their warehouse; the server previews against ONE. Rows are grouped (in practice there is one group).
    async previewBinCreates({ proposals }) {
      const byWarehouse = new Map();
      for (const p of proposals ?? []) {
        const list = byWarehouse.get(p.warehouseId) ?? [];
        list.push({ area: p.area, aisle: p.aisle, bay: p.bay, position: p.position, idempotencyKey: p.idempotencyKey, ...(p.name ? { name: p.name } : {}) });
        byWarehouse.set(p.warehouseId, list);
      }
      const rows = [];
      for (const [warehouseId, list] of byWarehouse) {
        const data = unwrap(await callApi("previewBinCreates", { warehouseId, proposals: list }));
        rows.push(...(data?.rows ?? []));
      }
      return { rows };
    },
    // Partial success is normal: the answer is one item per bin, and `complete` is true only when none was refused.
    async createBins({ warehouseId, proposals, reason }) {
      return unwrap(await callApi("createBins", {
        warehouseId, reason,
        proposals: proposals.map((p) => ({ area: p.area, aisle: p.aisle, bay: p.bay, position: p.position, idempotencyKey: p.idempotencyKey, ...(p.name ? { name: p.name } : {}) })),
      }));
    },
    async renameBin({ binId, name, reason }) { return unwrap(await callApi("renameRackingBin", { binId, name, ...(reason ? { reason } : {}) })); },
    deactivateBin: ({ binId, reason }) => status(binId, "INACTIVE", reason),
    reactivateBin: ({ binId, reason }) => status(binId, "ACTIVE", reason),
  });
}

/** The planner's warehouse picker, in the shape the screen reads ({ id, name }): the caller's own companies' warehouses only. */
export async function loadRackingWarehouses({ callApi = callPolicyApi } = {}) {
  const data = unwrap(await callApi("listRackingWarehouses", {}));
  return (data?.items ?? []).map((w) => ({ id: w.warehouseId, name: w.name, siteLabel: w.siteLabel ?? null, status: w.status }));
}

export const eosRackingClient = createEosRackingClient();
