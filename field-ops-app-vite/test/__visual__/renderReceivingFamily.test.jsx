// VISUAL HARNESS — Family 9 handheld sweep (frame 1f). Renders the real Receiving surfaces, with
// the real stylesheet, to static files whose LAYOUT can be measured in an actual browser at
// 1440/768/375/320 — jsdom computes no layout, so the measuring pass lives outside it.
//
// Long-but-valid values are deliberate: a long supplier name, long serials, a long location label
// and long sanitized copy are exactly what widens a page on a dock phone.
//
// Skipped unless VISUAL=1. Companion behaviour suites: receivingWorkspaceComposition,
// multiScanReceiving, receiveAgainstPurchaseOrderComponent, acquireExistingUnitComposition.
import { describe, it, vi } from "vitest";
import { render, fireEvent, screen, cleanup, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

// ── Frame 1a mocks (the workspace's reads and journeys) ─────────────────────────────────
let reorderRequests = { data: [], loading: false };
let purchaseOrdersById = { purchaseOrdersById: {}, loading: false };
let suppliers = { loading: false, error: null, suppliers: [{ id: "sup-1", name: "Refrigeration Wholesale of the Mountain West, Inc." }], truncated: false };
vi.mock("../../src/hooks/useReorderRequests", () => ({ useReorderRequestsByStatuses: () => reorderRequests }));
vi.mock("../../src/hooks/usePurchaseOrdersByIds", () => ({ usePurchaseOrdersByIds: () => purchaseOrdersById }));
vi.mock("../../src/hooks/useSuppliers", () => ({ useSuppliers: () => suppliers }));
vi.mock("../../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../../src/access/useSerializedAssetAcquireCapability", () => ({
  useSerializedAssetAcquireCapability: () => ({ canAcquire: true }),
}));
vi.mock("../../src/hooks/useSerialTrackedParts", async (orig) => {
  const actual = await orig();
  return { ...actual, useSerialTrackedParts: vi.fn() };
});

import { RECEIVING_OUTCOME } from "../../src/domain/receivingTransport.js";
import { SERIAL_PARTS_STATUS } from "../../src/hooks/useSerialTrackedParts";
import Receiving from "../../src/modules/inventory/Receiving.jsx";
import MultiScanReceiving from "../../src/modules/receiving/MultiScanReceiving.jsx";
import ReceiveAgainstPurchaseOrder from "../../src/modules/receiving/ReceiveAgainstPurchaseOrder.jsx";
import AcquireExistingUnit from "../../src/modules/receiving/AcquireExistingUnit.jsx";

vi.mock("../../src/services/receivingCallableClient", () => ({
  fetchReceivablePurchaseOrders: (...a) => mockFetchReceivable(...a),
  fetchReceivingLocationOptions: (...a) => mockFetchLocations(...a),
  fetchPurchaseOrderProgress: (...a) => mockFetchProgress(...a),
  submitCanonicalReceive: async () => ({ status: "unavailable" }),
  submitReceiveInventoryStock: (...a) => mockSubmitReceive(...a),
}));
vi.mock("../../src/services/partMasterQueries", () => ({ fetchPartMasterList: (...a) => mockFetchParts(...a) }));

let mockFetchReceivable = async () => ({ status: RECEIVING_OUTCOME.READY, purchaseOrders: [] });
let mockFetchLocations = async () => ({
  status: RECEIVING_OUTCOME.READY,
  options: [{ value: "wh_main", label: "Main Distribution Center — Phoenix Regional Warehouse", locationId: "wh_main" }],
});
let mockFetchProgress = async () => ({ status: RECEIVING_OUTCOME.READY, progress: null });
let mockFetchParts = async () => ({ ok: true, parts: [], invalid: [] });
let mockSubmitReceive = async () => ({ status: "applied" });

function page(title, html) {
  const css = fs.readFileSync(path.resolve("src/index.css"), "utf-8");
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css}</style>
<body class="fo-app" style="margin:0;padding:12px;background:var(--color-surface-page)">${html}</body>`;
}
const write = (name, html) => fs.writeFileSync(path.join(process.env.VISUAL_OUT || ".", name), html);
const LONG_SERIAL = "SN-C712-2026-PHX-000041-REMAN-B-EXCHANGE-9931";

const SUPPLIER_POS = [
  { purchaseOrderId: "fs-auto-9pQ7xW", supplierId: "sup-1", storedStatus: "SENT", lineCount: 6 },
  { purchaseOrderId: "fs-auto-2kL0aa", supplierId: "sup-unresolved", storedStatus: "APPROVED", lineCount: 3 },
];
function reorderCandidates() {
  reorderRequests = { data: [{ id: "reorder-doc-1", status: "ORDERED" }, { id: "reorder-doc-2", status: "ORDERED" }], loading: false };
  purchaseOrdersById = {
    purchaseOrdersById: {
      "reorder-doc-1": { status: "ORDERED", partId: "X49463-SER-3-EXTENDED", supplierName: "Refrigeration Wholesale of the Mountain West, Inc.", externalPoNumber: "TP-2026-88112-PHOENIX-RESUPPLY", orderedQuantity: 12 },
      "reorder-doc-2": { status: "ORDERED", partId: "016132", supplierName: "Taylor Distribution", externalPoNumber: null, orderedQuantity: 200 },
    },
    loading: false,
  };
}

const PROGRESS = {
  purchaseOrderId: "fs-auto-9pQ7xW",
  supplierId: "sup-1",
  supplierName: "Refrigeration Wholesale of the Mountain West, Inc.",
  storedStatus: "SENT",
  derivedState: "PARTIALLY_RECEIVED",
  receivable: true,
  version: 3,
  lines: [
    { lineId: "L1", partId: "X49463-SER-3-EXTENDED", trackingMode: "SERIAL", orderedQuantity: 2, receivedQuantity: 0, remainingQuantity: 2, state: "NOT_RECEIVED" },
    { lineId: "L2", partId: "016132", trackingMode: "NONE", orderedQuantity: 200, receivedQuantity: 120, remainingQuantity: 80, state: "PARTIALLY_RECEIVED" },
  ],
};

describe.skipIf(!process.env.VISUAL)("visual harness — Receiving family (frame 1f)", () => {
  it("writes the representative family states", async () => {
    // 1a — READY queue with both journeys' rows (incl. long identity + stated absences)
    mockFetchReceivable = async () => ({ status: RECEIVING_OUTCOME.READY, purchaseOrders: SUPPLIER_POS });
    reorderCandidates();
    render(<Receiving />);
    await screen.findByRole("table", { name: /orders awaiting receipt/i });
    write("family-1a-queue.rendered.html", page("Receiving — queue", document.body.innerHTML));
    cleanup();

    // 1a — READY_PARTIAL (supplier source unavailable)
    mockFetchReceivable = async () => ({ status: RECEIVING_OUTCOME.UNAVAILABLE, purchaseOrders: [] });
    render(<Receiving />);
    await screen.findByText(/incomplete/);
    write("family-1a-partial.rendered.html", page("Receiving — partial queue", document.body.innerHTML));
    cleanup();

    // 1b — active multi-scan session with a blocked scan and long values
    mockFetchProgress = async () => ({ status: RECEIVING_OUTCOME.READY, progress: PROGRESS });
    render(<MultiScanReceiving initialPurchaseOrderId="fs-auto-9pQ7xW" onExit={() => {}} />);
    await screen.findByLabelText(/^part$/i);
    fireEvent.change(screen.getByLabelText(/^part$/i), { target: { value: "X49463-SER-3-EXTENDED" } });
    fireEvent.change(screen.getByLabelText(/^serial$/i), { target: { value: LONG_SERIAL } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    fireEvent.change(screen.getByLabelText(/^part$/i), { target: { value: "GHOST-PART-NOT-ON-THIS-ORDER-044719" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await screen.findByText(/not on this purchase order/i);
    write("family-1b-session.rendered.html", page("Supplier session", document.body.innerHTML));
    cleanup();

    // 1d — review/confirm with serials
    reorderCandidates();
    mockFetchParts = async () => ({ ok: true, parts: [{ partId: "X49463-SER-3-EXTENDED", controlType: "SERIALIZED" }], invalid: [] });
    render(<ReceiveAgainstPurchaseOrder initialReorderRequestId="reorder-doc-1" onDone={() => {}} />);
    await screen.findByLabelText(/receiving location/i);
    fireEvent.change(screen.getByLabelText(/receiving location/i), { target: { value: "wh_main" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // ordered quantity is 12 → 12 serial fields; fill them with long serials
    const serialInputs = await screen.findAllByLabelText(/Serial \d+/);
    serialInputs.forEach((input, i) => fireEvent.change(input, { target: { value: `${LONG_SERIAL}-${i + 1}` } }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("button", { name: "Confirm receipt" });
    write("family-1d-review.rendered.html", page("Reorder review", document.body.innerHTML));
    cleanup();

    // 1c — form, review, success (the sheet portals onto document.body)
    const PARTS = { status: SERIAL_PARTS_STATUS.READY, options: [{ value: "part_c712", label: "Taylor C712 — Soft Serve Freezer, Two-Flavor w/ Twist" }] };
    const sheet = (over = {}) => render(
      <AcquireExistingUnit
        canAcquire
        locationOptions={[{ value: "wh_main", label: "Main Distribution Center — Phoenix Regional Warehouse" }]}
        locationsStatus={RECEIVING_OUTCOME.READY}
        onClose={() => {}}
        onAcquired={() => {}}
        deps={{ useParts: () => PARTS, callAcquire: over.callAcquire ?? (async () => ({})) }}
      />,
    );
    sheet();
    write("family-1c-form.rendered.html", page("Add existing unit — form", document.body.innerHTML));
    const fill = () => {
      fireEvent.change(screen.getByLabelText("Part"), { target: { value: "part_c712" } });
      fireEvent.change(screen.getByLabelText("Serial number"), { target: { value: LONG_SERIAL } });
      fireEvent.change(screen.getByLabelText("Company location"), { target: { value: "wh_main" } });
      fireEvent.click(screen.getByRole("radio", { name: /Existing company asset/ }));
      fireEvent.change(screen.getByLabelText(/Provenance note/), { target: { value: "Recovered from the decommissioned Flagstaff satellite depot during the July consolidation; ownership confirmed by the controller." } });
    };
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Review acquisition" }));
    write("family-1c-review.rendered.html", page("Add existing unit — review", document.body.innerHTML));
    cleanup();

    sheet({ callAcquire: async () => ({ outcome: { outcome: "acquired", serializedAssetId: "sa_1" } }) });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Review acquisition" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm acquisition" }));
    await waitFor(() => screen.getByText("Added to company inventory."));
    write("family-1c-success.rendered.html", page("Add existing unit — success", document.body.innerHTML));
    cleanup();
  });
});
