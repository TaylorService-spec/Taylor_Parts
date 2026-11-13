// VISUAL HARNESS — Compact UX Standard before/after pages (docs/design/compact-ux-standard.md).
// Renders the real page components to static files with the real stylesheet. Not an assertion suite.
//
// Same technique as the other harnesses here: real components, transports injected as stubs, no dev
// server, no sign-in, no credentials. Run on the base commit for "before" and on the branch for "after",
// then screenshot the files at 1440 and 375.
//
// Skipped unless VISUAL=1, so it never runs in CI or in the normal suite.
//   VISUAL=1 VISUAL_OUT=<dir> npx vitest run test/__visual__/renderCompactUx.test.jsx

import { describe, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";

vi.mock("../../src/hooks/useCurrentTechnician", () => ({
  useCurrentTechnician: () => ({ technicianId: null, loading: false, error: null, retry: () => {} }),
}));
vi.mock("../../src/hooks/useAssignedWorkOrders", () => ({
  useAssignedWorkOrders: () => ({ data: [], loading: false, error: null }),
}));
vi.mock("../../src/auth/AuthContext", () => ({
  useAuth: () => ({ role: null, user: { uid: "U1" } }),
}));

const { default: AdministrationOverview } = await import("../../src/modules/administration/AdministrationOverview.jsx");
const { default: ScanWorkspace } = await import("../../src/modules/scan/ScanWorkspace.jsx");
const scan = await import("../../src/access/scanWorkflows.js");

function write(container, name, title) {
  const css = fs.readFileSync(path.resolve("src/index.css"), "utf-8");
  const out = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css}
body { margin: 0; background: var(--color-surface-page, #f6f5f1); }
.harness-main { box-sizing: border-box; max-width: 1188px; padding: 24px; }
@media (max-width: 640px) { .harness-main { padding: 12px; } }</style>
<body class="fo-app"><main class="harness-main">${container.innerHTML}</main></body>`;
  fs.writeFileSync(path.join(process.env.VISUAL_OUT || ".", name), out);
}

const settle = () => new Promise((r) => setTimeout(r, 60));

describe.skipIf(!process.env.VISUAL)("visual harness — Compact UX pages", () => {
  it("writes Administration Overview", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ commit: "test", buildTime: "2026-10-15T15:00:00.000Z", environmentId: "eos-nonprod", environmentRole: "nonprod" }),
    });
    const { container } = render(
      <MemoryRouter initialEntries={["/administration/overview"]}>
        <AdministrationOverview fetchImpl={fetchImpl} />
      </MemoryRouter>,
    );
    await settle();
    write(container, "admin-overview.html", "Administration Overview");
    cleanup();
  });

  it("writes the Scan chooser (Service -> Scan; Inventory -> Warehouse Workspace on a desk)", async () => {
    // A warehouse persona: receiving, transfers, counts and relocation granted; returns intake and the
    // technician work-order scanner refused -- so both the chooser and the refusal list render.
    const granted = new Set([
      scan.RECEIVE_CAPABILITY, scan.TRANSFER_DISPATCH_CAPABILITY, scan.TRANSFER_RECEIVE_CAPABILITY,
      scan.CYCLE_COUNT_CREATE_CAPABILITY, scan.CYCLE_COUNT_SUBMIT_CAPABILITY, scan.STOCK_RELOCATE_CAPABILITY,
      scan.PLACEMENT_RECORD_CAPABILITY, ...scan.BIN_LOOKUP_CAPABILITY_IDS,
    ]);
    const deps = { hasCapability: (id) => granted.has(id), receivingReady: true, role: null, technicianId: null, assignedWorkOrderCount: 0, rememberWorkflow: false };
    const { container } = render(<ScanWorkspace deps={deps} />);
    await settle();
    write(container, "scan.html", "Scan");
    cleanup();
  });
});
