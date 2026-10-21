// THE GOVERNED DENIAL FOR A DIRECT URL (UAT AUTH-UI-01).
//
// App.jsx emits one of these for every subnav item the principal cannot see, so a typed or bookmarked
// address states its refusal instead of falling through to a record lookup or the catch-all. It used to be a
// bare "filtered" empty state: the right words under a "no results" icon, and a dead end -- nothing on the
// page said where an authorized person could go next.
//
// This is PRESENTATION ONLY. It is reached because isNavItemVisible already said no; it decides nothing,
// mounts nothing the route did not, and grants nothing. The route back is computed from the SAME
// isDomainVisible/isNavItemVisible answers the rail uses (navRole, allowed keys and operational context are
// the already-contained values AppRoutes passes), so it can only ever point at a destination this principal
// can open.
import { Link } from "react-router-dom";
import EmptyState from "../shared/ui/EmptyState.jsx";
import { firstAuthorizedDestination } from "./firstAuthorizedDestination.js";

export default function DeniedDestination({ label, role, allowedLegacyKeys, operationalContext }) {
  const back = firstAuthorizedDestination(role, allowedLegacyKeys, operationalContext);
  return (
    <EmptyState
      variant="denied"
      title={`${label} isn't available to your role`}
      message="Your account doesn't have access to this area. Contact an administrator if you believe this is an error."
      action={back ? <Link to={back.to}>Go to {back.label}</Link> : null}
    />
  );
}
