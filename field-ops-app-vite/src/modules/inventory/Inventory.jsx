import { useState, useEffect, useRef, useMemo } from "react";
import { useInventory } from "../../demo/InventoryContext";
import { LOW_STOCK_THRESHOLD } from "../../demo/inventoryData";
import { HERO_IDS } from "../../demo/heroConfig";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

// Client-side sort columns for a stock table: the part's name / unit, and its quantity in `stock`.
function stockSortColumns(stock) {
  return {
    part: { value: (part) => part.name ?? null },
    unit: { value: (part) => part.unit ?? null },
    qty: { value: (part) => stock[part.id] ?? 0 },
  };
}

// Sprint 3.6.2: Inventory screen -- Warehouse stock, Truck stock, and a
// Warehouse -> Truck transfer control. Visual/demo layer only: all state
// comes from demo/InventoryContext.jsx (in-memory, no Firestore), and
// this component only reads it and calls transferPart(). No inventory
// architecture, no persistence, no new collection.
//
// Hero-story follow-up: there's only ever one truck in this demo layer
// (see demo/InventoryContext.jsx), so it's labeled with
// demo/heroConfig.js's HERO_IDS.truck and always visually emphasized --
// no "else" branch is needed since there's nothing to compare it against.
// A part's quantity cell briefly flashes when it changes (transfer or
// Use Part), purely as a CSS class toggled by useFlashOnChange below --
// no new state model, no persistence.

function useFlashOnChange(value) {
  const [flashing, setFlashing] = useState(false);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value;
      setFlashing(true);
      const timer = setTimeout(() => setFlashing(false), 600);
      return () => clearTimeout(timer);
    }
  }, [value]);

  return flashing;
}

function QuantityCell({ value, children }) {
  const flashing = useFlashOnChange(value);
  return <td className={flashing ? "fo-qty-flash" : ""}>{children}</td>;
}

export default function Inventory() {
  const { parts, warehouseStock, truckStock, transferPart } = useInventory();
  const [transferPartId, setTransferPartId] = useState(parts[0]?.id ?? "");
  const [transferQty, setTransferQty] = useState(1);
  const warehouseColumns = useMemo(() => stockSortColumns(warehouseStock), [warehouseStock]);
  const truckColumns = useMemo(() => stockSortColumns(truckStock), [truckStock]);
  const warehouseSort = useTableSort({ rows: parts, columns: warehouseColumns });
  const truckSort = useTableSort({ rows: parts, columns: truckColumns });

  function handleTransfer(e) {
    e.preventDefault();
    const qty = Number(transferQty);
    if (!transferPartId || !Number.isFinite(qty) || qty <= 0) return;
    transferPart(transferPartId, qty);
  }

  return (
    <WorkspaceShell title="Inventory">
      {/* Warehouse Inventory, Truck Inventory, and Transfer are three distinct page REGIONS, not
          peer objects in a collection -- the card primitive is deliberately not used here (a card
          is for a bounded peer object; a section is for a fixed page region). Plain sections. */}
      <section aria-labelledby="inv-warehouse">
        <h3 id="inv-warehouse">Warehouse Inventory</h3>
        <table className="fo-table">
          <thead>
            <tr>
              <SortableHeader columnKey="part" label="Part" sort={warehouseSort.sort} onSort={warehouseSort.toggle} />
              <SortableHeader columnKey="unit" label="Unit" sort={warehouseSort.sort} onSort={warehouseSort.toggle} />
              <SortableHeader columnKey="qty" label="On Hand" sort={warehouseSort.sort} onSort={warehouseSort.toggle} />
            </tr>
          </thead>
          <tbody>
            {warehouseSort.sorted.map((part) => {
              const qty = warehouseStock[part.id] ?? 0;
              const low = qty <= LOW_STOCK_THRESHOLD;
              return (
                <tr key={part.id}>
                  <td>{part.name}</td>
                  <td>{part.unit}</td>
                  <QuantityCell value={qty}>
                    {qty}
                    {low && <StatusPill tone="critical" label="Low Stock" />}
                  </QuantityCell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="inv-truck">
        <h3 id="inv-truck">
          Truck Inventory
          <span className="fo-chip fo-chip-hero">{HERO_IDS.truck}</span>
        </h3>
        <table className="fo-table">
          <thead>
            <tr>
              <SortableHeader columnKey="part" label="Part" sort={truckSort.sort} onSort={truckSort.toggle} />
              <SortableHeader columnKey="unit" label="Unit" sort={truckSort.sort} onSort={truckSort.toggle} />
              <SortableHeader columnKey="qty" label="On Truck" sort={truckSort.sort} onSort={truckSort.toggle} />
            </tr>
          </thead>
          <tbody>
            {truckSort.sorted.map((part) => {
              const qty = truckStock[part.id] ?? 0;
              return (
                <tr key={part.id}>
                  <td>{part.name}</td>
                  <td>{part.unit}</td>
                  <QuantityCell value={qty}>{qty}</QuantityCell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="inv-transfer">
        <h3 id="inv-transfer">Transfer: Warehouse → Truck</h3>
        <form className="fo-form" onSubmit={handleTransfer}>
          <select value={transferPartId} onChange={(e) => setTransferPartId(e.target.value)}>
            {parts.map((part) => (
              <option key={part.id} value={part.id}>
                {part.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            value={transferQty}
            onChange={(e) => setTransferQty(e.target.value)}
          />
          <Button type="submit">Transfer to Truck</Button>
        </form>
      </section>
    </WorkspaceShell>
  );
}
