import { createContext, useContext, useId, useRef } from "react";

// Customer Record Page sprint, PR 1 -- first Tabs implementation in
// this repository (docs/specifications/customer-record-page-structured-address.md's
// Component 1). Tabs owns exactly one thing: a React Context providing
// this instance's useId()-generated id and the current active-tab
// state to every Tab/TabPanel descendant -- same underlying useId()
// per-instance-uniqueness primitive EmployeeAssignmentPicker.jsx
// already establishes, owned by the Tabs root and shared via context
// here instead of a single component computing its own ids locally.
//
// Controlled component: the CALLER supplies only stable,
// business-meaningful tab ids ("details"/"locations"/"contacts") and
// owns activeTabId itself (useState or equivalent). Tabs never mutates
// its own selection state.
const TabsContext = createContext(null);

function useTabsContext(componentName) {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`${componentName} must be rendered inside <Tabs>`);
  }
  return ctx;
}

export function Tabs({ tabs, activeTabId, onChange, children }) {
  const instanceId = useId();
  const tablistRef = useRef(null);

  // Invalid activeTabId (matches no tab.id) falls back to the FIRST
  // tab, silently -- never renders with nothing selected. Same rule
  // applies if the tabs array itself changes and no longer contains
  // the previously-active id.
  const validIds = tabs.map((t) => t.id);
  const effectiveActiveId = validIds.includes(activeTabId) ? activeTabId : tabs[0]?.id;

  function focusTabByIndex(index) {
    const buttons = tablistRef.current?.querySelectorAll('[role="tab"]');
    buttons?.[index]?.focus();
  }

  function handleTablistKeyDown(e) {
    const currentIndex = tabs.findIndex((t) => t.id === effectiveActiveId);
    if (currentIndex === -1) return;

    let nextIndex = null;
    if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    const nextTab = tabs[nextIndex];
    onChange(nextTab.id);
    focusTabByIndex(nextIndex);
  }

  return (
    <TabsContext.Provider value={{ instanceId, tabs, activeTabId: effectiveActiveId, onChange }}>
      <div role="tablist" className="fo-tablist" ref={tablistRef} onKeyDown={handleTablistKeyDown}>
        {tabs.map((tab) => (
          <Tab key={tab.id} tab={tab} />
        ))}
      </div>
      {children}
    </TabsContext.Provider>
  );
}

function Tab({ tab }) {
  const { instanceId, activeTabId, onChange } = useTabsContext("Tab");
  const isActive = tab.id === activeTabId;
  const tabDomId = `${instanceId}-tab-${tab.id}`;
  const panelDomId = `${instanceId}-panel-${tab.id}`;

  return (
    <button
      type="button"
      role="tab"
      id={tabDomId}
      aria-selected={isActive}
      aria-controls={panelDomId}
      tabIndex={isActive ? 0 : -1}
      className={`fo-tab${isActive ? " fo-tab-active" : ""}`}
      onClick={() => onChange(tab.id)}
    >
      {tab.label}
    </button>
  );
}

export function TabPanel({ tabId, children }) {
  const { instanceId, activeTabId } = useTabsContext("TabPanel");

  // Every declared TabPanel stays MOUNTED at all times, active or not
  // -- never conditionally returns null. An unmounted inactive panel
  // would mean its tab's aria-controls points at a DOM id that doesn't
  // exist. Inactive panels are hidden via the native `hidden` attribute
  // instead (removes the element from the accessibility tree and the
  // tab order without unmounting it), so any in-progress, unsaved
  // panel-local state (e.g. a half-filled "+ Add Location" draft)
  // survives switching to another tab and back.
  const isActive = tabId === activeTabId;
  const panelDomId = `${instanceId}-panel-${tabId}`;
  const tabDomId = `${instanceId}-tab-${tabId}`;

  return (
    <div role="tabpanel" id={panelDomId} aria-labelledby={tabDomId} hidden={!isActive}>
      {children}
    </div>
  );
}
