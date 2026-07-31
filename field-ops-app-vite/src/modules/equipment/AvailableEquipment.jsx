// INV-EQ-P1b -- the Available Equipment tab. A VISIBLE second tab that reads
// Serialized Assets available for assignment through an injected source. Until the
// Enterprise Inventory Serialized Asset registry exists, the default source is inert
// and this renders an HONEST "not yet connected" state -- never a blank panel and
// never fabricated inventory. When granted assets, it composes safe rows via the
// merged pure P1a selectAvailableSerializedAssets. No persistence/stock is authored.
import { selectAvailableSerializedAssets } from "../../domain/serializedAssetInstallation";
import {
  inertSerializedAssetSource,
  readSerializedAssetSource,
  SERIALIZED_ASSET_SOURCE_STATUS,
} from "../../access/serializedAssetSource";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";

export default function AvailableEquipment({ source = inertSerializedAssetSource }) {
  const { status, assets } = readSerializedAssetSource(source);

  if (status === SERIALIZED_ASSET_SOURCE_STATUS.DENIED) {
    return (
      <FailureState
        title="Available Equipment unavailable"
        message="You are not able to view available Serialized Assets."
      />
    );
  }

  if (status !== SERIALIZED_ASSET_SOURCE_STATUS.READY) {
    // Honest not-yet-connected surface (registry not built). Visible, never blank.
    return (
      <div className="fo-panel" role="status">
        <h3>Available Equipment</h3>
        <p className="fo-muted">
          Available Equipment lists serialized inventory units ready to assign to a customer. This tab
          is connected to the governed Serialized Asset registry, which is not available yet — no
          inventory is shown until that backend ships and is verified. Nothing here is simulated.
        </p>
      </div>
    );
  }

  const available = selectAvailableSerializedAssets(assets);

  if (available.length === 0) {
    return <EmptyState title="No available Equipment" message="No serialized assets are currently available for assignment." />;
  }

  return (
    <div className="fo-panel">
      <h3>Available Equipment</h3>
      <ul className="fo-list">
        {available.map((a) => (
          <li key={a.serialNo}>
            <span>{a.serialNo}</span>
            {a.partId ? <span className="fo-muted"> — {a.partId}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
