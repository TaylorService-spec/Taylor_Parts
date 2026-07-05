import { useMemo, useState } from "react";
import { PARTS_CATALOG } from "../../../data/partsCatalog";

// Step 4 -- Planned Parts. Searches the existing, static partsCatalog.ts
// (Epic 1.1) by SKU/name/category and lets the dispatcher add
// { sku, qtyPlanned } entries, populating form.inventorySnapshot --
// exactly WorkOrder.inventorySnapshot's shape (types/workOrder.ts).
// Purely descriptive: no inventory transactions, no warehouse
// deduction, no stock validation against catalog.warehouseQty --
// matches Epic 1.1's ADR-002 boundary exactly.
export default function PartsStep({ form, onChange }) {
  const [query, setQuery] = useState("");
  const [qty, setQty] = useState(1);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return PARTS_CATALOG.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [query]);

  function addPart(part) {
    const existing = form.inventorySnapshot.find((item) => item.sku === part.sku);
    const nextSnapshot = existing
      ? form.inventorySnapshot.map((item) =>
          item.sku === part.sku ? { ...item, qtyPlanned: item.qtyPlanned + qty } : item
        )
      : [...form.inventorySnapshot, { sku: part.sku, name: part.name, category: part.category, qtyPlanned: qty }];
    onChange({ inventorySnapshot: nextSnapshot });
  }

  function removePart(sku) {
    onChange({ inventorySnapshot: form.inventorySnapshot.filter((item) => item.sku !== sku) });
  }

  return (
    <div className="fo-wizard-step">
      <label>
        Search Parts (SKU, name, or category)
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. TST-1001, Hex Coupler, Filters" />
      </label>

      {results.length > 0 && (
        <table className="fo-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Category</th>
              <th>Qty</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {results.map((part) => (
              <tr key={part.sku}>
                <td>{part.sku}</td>
                <td>{part.name}</td>
                <td className="fo-muted">{part.category}</td>
                <td>
                  <input
                    type="number"
                    min="1"
                    value={qty}
                    onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                    style={{ width: 60 }}
                  />
                </td>
                <td>
                  <button type="button" onClick={() => addPart(part)}>
                    Add
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Planned Parts</h4>
      {form.inventorySnapshot.length === 0 ? (
        <p className="fo-muted">No parts added yet.</p>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Qty Planned</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {form.inventorySnapshot.map((item) => (
              <tr key={item.sku}>
                <td>{item.sku}</td>
                <td>{item.name}</td>
                <td>{item.qtyPlanned}</td>
                <td>
                  <button type="button" onClick={() => removePart(item.sku)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
