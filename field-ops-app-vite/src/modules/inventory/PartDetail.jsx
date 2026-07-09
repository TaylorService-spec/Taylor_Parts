import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { getCatalogItem } from "../../data/partsCatalog";
import { useInventoryLedger } from "../../hooks/useInventoryLedger";

// Sprint 2.1.1 -- Inventory Domain Foundation. Part detail screen,
// reached from PartsList.jsx or Global Search. Read-only: catalog
// metadata comes from data/partsCatalog.ts (static), stock position/
// usage/recommendation and transaction history come from
// useInventoryLedger() -- the same one-shot read + pure analytics
// functions PartsList.jsx and Operations.jsx both use. No new
// Firestore query, no new computed math.
function formatTimestamp(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export default function PartDetail() {
  const { partId } = useParams();
  const part = getCatalogItem(partId);
  const { transactions, healthEntries, loading } = useInventoryLedger();

  const health = useMemo(() => healthEntries.find((entry) => entry.partId === partId), [healthEntries, partId]);

  const partTransactions = useMemo(
    () =>
      transactions
        .filter((t) => t.partId === partId)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 20),
    [transactions, partId]
  );

  if (!part) {
    return (
      <div className="fo-panel">
        <p className="fo-muted">Unknown part "{partId}".</p>
        <Link to="/inventory">← Back to Parts</Link>
      </div>
    );
  }

  return (
    <div className="fo-panel">
      <Link to="/inventory">← Back to Parts</Link>
      <h2>{part.name}</h2>
      <p className="fo-muted">
        {part.sku} -- {part.category} -- {part.unit}
      </p>

      <div className="fo-card">
        <h3>Catalog</h3>
        <table className="fo-table">
          <tbody>
            <tr>
              <td>Cost</td>
              <td>${part.cost.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Price</td>
              <td>${part.price.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Warehouse baseline</td>
              <td>{part.warehouseQty}</td>
            </tr>
            <tr>
              <td>Reorder threshold (catalog)</td>
              <td>{part.reorderThreshold}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {loading ? (
        <p className="fo-muted">Loading stock position...</p>
      ) : health ? (
        <div className="fo-card">
          <h3>Stock Position &amp; Reorder Status</h3>
          <table className="fo-table">
            <tbody>
              <tr>
                <td>Available (ledger-derived)</td>
                <td>{health.stock.availableStock}</td>
              </tr>
              <tr>
                <td>Avg daily usage</td>
                <td>{health.usage.avgDailyUsage.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Days remaining</td>
                <td>
                  {Number.isFinite(health.recommendation.daysRemaining)
                    ? health.recommendation.daysRemaining.toFixed(1)
                    : "—"}
                </td>
              </tr>
              <tr>
                <td>Reorder point</td>
                <td>{Math.ceil(health.recommendation.reorderPoint)}</td>
              </tr>
              <tr>
                <td>Recommended reorder qty</td>
                <td>{Math.ceil(health.recommendation.recommendedOrderQty)}</td>
              </tr>
              <tr>
                <td>Risk</td>
                <td>
                  <span className={`fo-badge fo-badge-${health.recommendation.urgency.toLowerCase()}`}>
                    {health.recommendation.urgency}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fo-muted">No ledger activity yet for this part -- stock position not yet forecastable.</p>
      )}

      <div className="fo-card">
        <h3>Recent Transactions</h3>
        {partTransactions.length === 0 ? (
          <p className="fo-muted">No ledger transactions for this part yet.</p>
        ) : (
          <table className="fo-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Quantity</th>
                <th>Work Order</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {partTransactions.map((t) => (
                <tr key={t.id}>
                  <td>{t.type}</td>
                  <td>{t.quantity}</td>
                  <td className="fo-muted">{t.workOrderId}</td>
                  <td className="fo-muted">{formatTimestamp(t.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
