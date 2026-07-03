// Thin platform-level bar sitting above the app's own header/nav.
// "Home" is a plain page link back to Parts Control Center, not a
// client-side route -- the two apps are separate deployed builds
// (see vite.config.js base path), not one router-controlled SPA.

export default function AppHeader({ user, onLogout }) {
  return (
    <header className="app-header">
      <div className="brand">Field Ops Platform</div>

      <nav>
        <a href="../">Home</a>
      </nav>

      <div className="user">
        {user?.email}
        <button onClick={onLogout}>Logout</button>
      </div>
    </header>
  );
}
