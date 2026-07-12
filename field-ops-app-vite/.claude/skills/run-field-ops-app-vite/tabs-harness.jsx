import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Tabs, TabPanel } from "../../../src/shared/tabs/Tabs.jsx";

// Dev-only test harness -- NOT part of the production build. Not
// referenced by index.html, not added to build.rollupOptions.input, so
// `vite build` never emits or bundles it; it exists solely so
// verify-customer-record-page (driver.mjs) can prove the Tabs
// component's multi-instance contract (docs/specifications/
// customer-record-page-structured-address.md's rendered-DOM test
// requirements) against the REAL Tabs.jsx source, not a
// reimplementation, without adding any new route or customer-visible
// surface to AccountDetail.jsx or App.jsx. Only reachable by directly
// requesting this file's dev-server URL -- never linked from any nav,
// never shipped to production (GitHub Pages serves only `dist/`,
// built from index.html's own module graph, which this file is not
// part of).
//
// Instance A/B: two independent, simultaneously-mounted Tabs roots --
// proves unique DOM ids across instances and that keyboard handling in
// one instance never reaches the other's tabs.
// Instance C: activeTabId fixed to a value not present in `tabs`,
// proving the invalid-activeTabId fallback (first tab selected,
// exactly one panel visible, that tab's tabIndex is 0).
function Harness() {
  const [activeA, setActiveA] = useState("a1");
  const [activeB, setActiveB] = useState("b1");

  return (
    <div>
      <div id="instance-a">
        <Tabs
          tabs={[
            { id: "a1", label: "A-One" },
            { id: "a2", label: "A-Two" },
          ]}
          activeTabId={activeA}
          onChange={setActiveA}
        >
          <TabPanel tabId="a1">
            <button type="button">A1 focusable control</button>
          </TabPanel>
          <TabPanel tabId="a2">
            <button type="button">A2 focusable control</button>
          </TabPanel>
        </Tabs>
      </div>

      <div id="instance-b">
        <Tabs
          tabs={[
            { id: "b1", label: "B-One" },
            { id: "b2", label: "B-Two" },
          ]}
          activeTabId={activeB}
          onChange={setActiveB}
        >
          <TabPanel tabId="b1">
            <button type="button">B1 focusable control</button>
          </TabPanel>
          <TabPanel tabId="b2">
            <button type="button">B2 focusable control</button>
          </TabPanel>
        </Tabs>
      </div>

      <div id="instance-c">
        <Tabs
          tabs={[
            { id: "c1", label: "C-One" },
            { id: "c2", label: "C-Two" },
          ]}
          activeTabId="c-does-not-exist"
          onChange={() => {}}
        >
          <TabPanel tabId="c1">
            <button type="button">C1 focusable control</button>
          </TabPanel>
          <TabPanel tabId="c2">
            <button type="button">C2 focusable control</button>
          </TabPanel>
        </Tabs>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Harness />);
