import { useState } from "react";
import { useInventory } from "../../demo/InventoryContext";
import { LOW_STOCK_THRESHOLD } from "../../demo/inventoryData";

// Sprint 3.6.2: Inventory screen -- Warehouse stock, Truck stock, and a
// Warehouse -> Truck transfer control. Visual/demo layer only: all state
// comes from demo/InventoryContext.jsx (in-memory, no Firestore), and
// this component only reads it and calls transferPart(). No inventory
// architecture, no persistence, no new collection.
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
                  <td>
                    {qty}
                    {low && <span className="fo-badge fo-badge-low-stock"> Low Stock</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="fo-card">
        <h3>Truck Inventory</h3>
        <table className="fo-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Unit</th>
              <th>On Truck</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((part) => (
              <tr key={part.id}>
                <td>{part.name}</td>
                <td>{part.unit}</td>
                <td>{truckStock[part.id] ?? 0}</td>
              </tr>
            ))}
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
