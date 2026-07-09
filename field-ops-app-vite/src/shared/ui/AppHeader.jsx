import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useReorderRequests } from "../../hooks/useReorderRequests";
import NotificationPanel from "./NotificationPanel";

// Sprint 2.1.3 -- Reorder Request & Notification Foundation. Notification
// Panel is admin/dispatcher only (same role scope as Inventory today) --
// `enabled` skips the reorder_requests read entirely for a technician,
// who has no firestore.rules read access to it, rather than fetching and
// getting a permission-denied error.
export default function AppHeader() {
  const { user, role, logout } = useAuth();
  const canSeeReorderRequests = role === "admin" || role === "dispatcher";
  const { data: pendingReorderRequests } = useReorderRequests(canSeeReorderRequests);

  return (
    <div className="fo-appheader" style={styles.header}>
      <div className="fo-appheader-left" style={styles.left}>
        <span style={styles.title}>Field Ops Platform</span>

        {/* Sprint 2.0.1, requirement #6: Home used to hard-link to
            "/Taylor_Parts/" -- the legacy root Parts Control Center,
            a different app entirely. Now a client-side route to this
            app's own dashboard, not a page navigation away from it. */}
        <Link to="/dashboard" style={styles.link}>
          Home
        </Link>

        <a href="/Taylor_Parts/field-ops/" style={styles.link}>
          Refresh
        </a>
      </div>

      <div className="fo-appheader-right" style={styles.right}>
        {canSeeReorderRequests && <NotificationPanel requests={pendingReorderRequests} />}
        <span className="fo-appheader-email">{user?.email}</span>
        <button onClick={logout}>Logout</button>
      </div>
    </div>
  );
}

const styles = {
  header: {
    display: "flex",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: "1px solid #eee",
    background: "#fff"
  },
  left: {
    display: "flex",
    gap: "12px",
    alignItems: "center"
  },
  right: {
    display: "flex",
    gap: "10px",
    alignItems: "center"
  },
  title: {
    fontWeight: 600
  },
  link: {
    textDecoration: "none",
    color: "#2e4a50"
  }
};
