import { createContext, useContext } from "react";

// Minimal escape hatch for a child component (e.g. CreateWorkOrderWizard's
// "Create & Continue") to switch App.jsx's active NAV tab, without
// threading a callback prop through every NAV component's render (most
// of which don't need it). App.jsx is the only provider; this stays a
// thin context on purpose -- it does not carry any app/business state,
// only the ability to change which tab is active.
const NavigationContext = createContext(null);

export function NavigationProvider({ navigateToTab, children }) {
  return <NavigationContext.Provider value={navigateToTab}>{children}</NavigationContext.Provider>;
}

export function useNavigateToTab() {
  const navigateToTab = useContext(NavigationContext);
  if (!navigateToTab) {
    throw new Error("useNavigateToTab must be used within NavigationProvider (see App.jsx)");
  }
  return navigateToTab;
}
