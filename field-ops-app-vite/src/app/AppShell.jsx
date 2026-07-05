import SideNav from "../navigation/SideNav";

// Domain-routing scaffold (structural only) -- see AppRouter.jsx's
// header comment. No business logic -- renders SideNav and children,
// nothing else.
export default function AppShell({ children }) {
  return (
    <div className="fo-app">
      <SideNav />
      <main className="fo-main">{children}</main>
    </div>
  );
}
