import { useLocation } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary.jsx";

// A SCREEN-LEVEL BOUNDARY FOR THE EOS-ONLY SIGN-IN BUILD (Firebase exit B2).
//
// That build holds no Firebase config, so a screen whose batch has not migrated yet (B1 Financials, B3 Warehouse and
// receiving, B4 Records and reporting) cannot reach Firebase and may fail while it draws. Left to the root boundary, one such
// screen would replace the WHOLE app, navigation included. Here the failure stays inside the content area, keyed by the
// route, so moving to another screen mounts a fresh boundary and the shell keeps working. It is the same ErrorBoundary (same
// diagnostics, same "Try again"); only its reach is smaller. Mounted only when the build is EOS-only; every other build
// keeps the single root boundary exactly as before.
export default function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation();
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>;
}
