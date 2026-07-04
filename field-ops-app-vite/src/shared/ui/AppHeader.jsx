import React from "react";
import { useAuth } from "../../auth/AuthContext";

export default function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <div className="fo-appheader" style={styles.header}>
      <div className="fo-appheader-left" style={styles.left}>
        <span style={styles.title}>Field Ops Platform</span>

        <a href="/Taylor_Parts/" style={styles.link}>
          Home
        </a>

        <a href="/Taylor_Parts/field-ops/" style={styles.link}>
          Refresh
        </a>
      </div>

      <div className="fo-appheader-right" style={styles.right}>
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
