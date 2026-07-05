import { NavLink } from "react-router-dom";
import { navItems } from "./navConfig";

// Domain-routing scaffold (structural only) -- see
// src/app/AppRouter.jsx's header comment. No business logic, no data
// fetching, reads navConfig.js only.
export default function SideNav() {
  return (
    <nav className="fo-nav">
      {navItems.map((item) => (
        <NavLink
          key={item.id}
          to={item.path}
          className={({ isActive }) => (isActive ? "fo-nav-btn fo-nav-btn-active" : "fo-nav-btn")}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
