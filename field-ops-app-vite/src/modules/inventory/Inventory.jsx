import { useState, useEffect, useRef } from "react";
import { useInventory } from "../../demo/InventoryContext";
import { LOW_STOCK_THRESHOLD } from "../../demo/inventoryData";
import { HERO_IDS } from "../../demo/heroConfig";

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

  function handleTransfer(e) {
    e.preventDefault();
    const qty = Number(transferQty);
    if (!transferPartId || !Number.isFinite(qty) || qty <= 0) return;
    transferPart(transferPartId, qty);
  }

  return (
    <div className="fo-panel">
      <h2>Inventory</h2>

      <div className="fo-card">
        <h3>Warehouse Inventory</h3>
        <table className="fo-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Unit</th>
              <th>On Hand</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((part) => {
              const qty = warehouseStock[part.id] ?? 0;
              const low = qty <= LOW_STOCK_THRESHOLD;
              return (
                <tr key={part.id}>
                  <td>{part.name}</td>
                  <td>{part.unit}</td>
                  <QuantityCell value={qty}>
                    {qty}
                    {low && <span className="fo-badge fo-badge-low-stock"> Low Stock</span>}
                  </QuantityCell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="fo-card fo-card--hero">
        <h3>
          Truck Inventory
          <span className="fo-chip fo-chip-hero">{HERO_IDS.truck}</span>
        </h3>
        <table className="fo-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Unit</th>
              <th>On Truck</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((part) => {
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
      </div>

      <div className="fo-card">
        <h3>Transfer: Warehouse → Truck</h3>
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
          <button type="submit">Transfer to Truck</button>
        </form>
      </div>
    </div>
  );
}
