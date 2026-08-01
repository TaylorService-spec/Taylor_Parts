// EI Truck Registry -- the honest "not yet enabled" banner shown whenever the
// write-readiness seam is false. The eight trusted callables are exported-but-
// undeployed, so management controls are visible for review but do nothing until a
// later, separately-authorized activation gate deploys and verifies them.
export default function WriteDisabledNotice() {
  return (
    <p className="fo-warning" role="status" data-testid="truck-management-not-ready">
      Truck management is not yet enabled. These controls are shown for review only — no
      changes are saved until the trusted Truck functions are deployed and verified.
    </p>
  );
}
