// Step 3 -- Equipment. Explicitly optional/placeholder for MVP per this
// phase's spec -- there is no equipment collection/entity anywhere in
// this app, so this is not a functional lookup, just a reserved spot
// for future service-history integration. Collects nothing, sends
// nothing.
export default function EquipmentStep() {
  return (
    <div className="fo-wizard-step">
      <p className="fo-muted">
        Equipment lookup and service history are not implemented yet -- reserved for a future
        phase. This step is optional and can be skipped.
      </p>
    </div>
  );
}
