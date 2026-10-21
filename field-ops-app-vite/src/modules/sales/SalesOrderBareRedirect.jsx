import { Navigate, useParams } from "react-router-dom";

// The Sales Order page's ONE canonical address is /customers/opportunities/sales-order/:salesOrderId (App.jsx). The bare
// /opportunities/sales-order/:salesOrderId used to fall through to the catch-all and land a reader on /dashboard. This sends it to the
// canonical route instead; the canonical route still applies its own access check, so nothing is granted by arriving here.
export default function SalesOrderBareRedirect() {
  const { salesOrderId } = useParams();
  return <Navigate to={`/customers/opportunities/sales-order/${encodeURIComponent(salesOrderId)}`} replace />;
}
