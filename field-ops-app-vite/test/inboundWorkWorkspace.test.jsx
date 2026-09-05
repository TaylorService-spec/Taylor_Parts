// Service -> Inbound Work, rendered (vitest + jsdom). What this suite is actually for:
//
//   1. hostile message content arrives as TEXT and stays text -- no element is ever created from it;
//   2. the review screen shows the message and EOS's reading of it side by side;
//   3. Accept Job submits the REVIEWER'S confirmed values and nothing else -- no actor, no timestamp;
//   4. a role without the capability sees an honest denial, not an empty screen or a live button.
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const capabilities = { value: new Set(["service.inboundWork.read", "service.inboundWork.accept", "service.inboundWork.decline", "service.inboundWork.attachExisting"]) };

vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "reviewer-uid" } }) }));
vi.mock("../src/access/useGovernedCapabilities.js", () => ({
  useGovernedCapabilities: () => ({ hasCapability: (id) => capabilities.value.has(id), accessVersion: 1 }),
}));
// The pickers reach Firestore for their options; this suite is about the review screen, and the pickers
// have their own. The customer suggestion is already resolved on the fixture, so no picking is required.
vi.mock("../src/hooks/useAccountPicker", () => ({ useAccountPicker: () => ({ options: [] }) }));
vi.mock("../src/hooks/useLocationsForAccount", () => ({
  useLocationsForAccount: () => ({ data: [{ id: "loc-1", name: "North site" }], error: null, retry: () => {} }),
}));
vi.mock("../src/hooks/useEquipment", () => ({ useEquipmentForAccount: () => ({ data: [], loading: false, error: null }) }));
const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => navigate }));

const InboundWorkWorkspace = (await import("../src/modules/service/InboundWorkWorkspace.jsx")).default;

// The plain-text body the trusted read returns: the server already stripped the markup, and this is what
// a hostile message looks like by the time any browser sees it.
const HOSTILE_TEXT = 'Unit down. alert("xss") img src=x onerror=alert(1)';

const detail = {
  id: "req-1",
  status: "AWAITING_DECISION",
  receivedAt: 1756742640000,
  sender: "dispatch@corporate.example",
  subject: "Warranty service required",
  requestType: "WARRANTY",
  priority: 2,
  queue: "WARRANTY_REVIEW",
  operatingCompanyId: null,
  customerCandidateId: "acct-1",
  equipmentCandidateId: "eq-1",
  attachmentCount: 1,
  warnings: ["NO_SERIAL_NUMBER"],
  workItemId: null,
  sourceProvider: "MICROSOFT_365",
  sourceConnectionId: "conn-1",
  sourceMailboxId: "mb-warranty",
  sourceMessageId: "msg-1",
  sourceThreadId: "conv-1",
  recipients: ["warranty@sandbox.example"],
  cc: [],
  originalBodyText: HOSTILE_TEXT,
  normalizedBody: HOSTILE_TEXT,
  attachmentRefs: [
    { filename: "authorization.pdf", mimeType: "application/pdf", size: 2048, providerAttachmentId: "att-1", sourceMessageId: "msg-1", custody: "STORED" },
    { filename: "photo.jpg", mimeType: "image/jpeg", size: 4096, providerAttachmentId: "att-2", sourceMessageId: "msg-1", custody: "FAILED", failureCode: "ATTACHMENT_FETCH_FAILED" },
  ],
  attachmentCustody: "PARTIAL",
  threadMessages: [],
  customerCandidate: { id: "acct-1", rawValue: "SN-1", confidence: "EXACT", matchedOn: "serialNumberKey" },
  locationCandidate: { id: "loc-1", rawValue: "SN-1", confidence: "EXACT", matchedOn: "equipmentLocation" },
  equipmentCandidate: { id: "eq-1", rawValue: "SN-1", confidence: "EXACT", matchedOn: "serialNumberKey" },
  externalReference: "CASE-88213",
  authorizationNumber: "WR-4471",
  problemDescription: "unit is not cooling",
  serialNumber: null,
  modelNumber: "C712",
  routingRuleId: "rule-warranty",
  routingOutcome: "matched",
  threadAssociation: "NEW",
  processingProvider: "EOS_NATIVE",
  processingError: null,
  decision: null,
  decisionReason: null,
  decisionBy: null,
  customerId: null,
  customerLocationId: null,
  equipmentId: null,
};

const row = {
  id: detail.id,
  status: detail.status,
  receivedAt: detail.receivedAt,
  sender: detail.sender,
  subject: detail.subject,
  requestType: detail.requestType,
  priority: detail.priority,
  queue: detail.queue,
  operatingCompanyId: null,
  customerCandidateId: "acct-1",
  equipmentCandidateId: "eq-1",
  attachmentCount: 1,
  warnings: detail.warnings,
  workItemId: null,
};

function makeSource(overrides = {}) {
  return {
    listQueue: async () => ({ status: "ready", payload: { rows: [row], truncated: false }, error: null }),
    getRequest: async () => ({ status: "ready", payload: detail, error: null }),
    accept: async () => ({ ok: true, data: { requestId: "req-1", workItemId: "wo-1", woNumber: "WO-2026-000001", replayed: false } }),
    decline: async () => ({ ok: true, data: { requestId: "req-1", replayed: false } }),
    attach: async () => ({ ok: true, data: { requestId: "req-1", workItemId: "wo-9", replayed: false } }),
    getAttachment: async () => ({ ok: true, data: { filename: "authorization.pdf", declaredMimeType: "application/pdf", size: 3, contentHash: "h", contentBase64: "UERG" } }),
    ...overrides,
  };
}

// jsdom implements no object-URL machinery, and the download path is the only thing here that wants it.
// Stubbed rather than worked around in the component: a browser always has this, and a component that
// checked for it would be carrying a branch that exists only for the test environment.
beforeAll(() => {
  if (typeof URL.createObjectURL !== "function") URL.createObjectURL = () => "blob:stub";
  if (typeof URL.revokeObjectURL !== "function") URL.revokeObjectURL = () => {};
});

afterEach(() => {
  cleanup();
  navigate.mockReset();
  capabilities.value = new Set(["service.inboundWork.read", "service.inboundWork.accept", "service.inboundWork.decline", "service.inboundWork.attachExisting"]);
});

describe("Inbound Work queue", () => {
  it("lists what arrived, with the sender and the routed request type", async () => {
    render(<InboundWorkWorkspace source={makeSource()} />);
    expect(await screen.findByText("dispatch@corporate.example")).toBeTruthy();
    expect(screen.getByText("Warranty service required")).toBeTruthy();
    expect(screen.getByText("WARRANTY")).toBeTruthy();
  });

  it("says DENIED rather than showing an empty queue when the role does not include it", async () => {
    capabilities.value = new Set();
    render(<InboundWorkWorkspace source={makeSource()} />);
    expect(await screen.findByText(/isn't part of your role/i)).toBeTruthy();
  });

  it("says UNAVAILABLE, distinctly, when the governed read fails", async () => {
    render(<InboundWorkWorkspace source={makeSource({ listQueue: async () => ({ status: "unavailable", payload: null, error: "internal" }) })} />);
    expect(await screen.findByText(/couldn't be loaded/i)).toBeTruthy();
  });
});

describe("Inbound Work review", () => {
  const open = async () => {
    render(<InboundWorkWorkspace source={makeSource()} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    await screen.findByRole("region", { name: "Original message" });
  };

  it("shows the original message and the EOS interpretation together", async () => {
    await open();
    expect(screen.getByRole("region", { name: "Original message" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "EOS work interpretation" })).toBeTruthy();
    expect(screen.getByText("WR-4471")).toBeTruthy();
    expect(screen.getByText("CASE-88213")).toBeTruthy();
    expect(screen.getByText("authorization.pdf")).toBeTruthy();
  });

  it("renders hostile message content as TEXT -- no element is created from it", async () => {
    await open();
    const region = screen.getByRole("region", { name: "Original message" });
    expect(region.textContent).toContain('alert("xss")');
    expect(region.querySelector("img")).toBeNull();
    expect(region.querySelector("script")).toBeNull();
  });

  it("Accept Job submits the reviewer's confirmed values -- and no actor or timestamp", async () => {
    const accept = vi.fn(async () => ({ ok: true, data: { requestId: "req-1", workItemId: "wo-1", replayed: false } }));
    render(<InboundWorkWorkspace source={makeSource({ accept })} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    fireEvent.click(await screen.findByRole("button", { name: "Accept Job" }));

    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));
    const payload = accept.mock.calls[0][0];
    expect(payload.requestId).toBe("req-1");
    expect(payload.customerId).toBe("acct-1");
    expect(payload.locationId).toBe("loc-1");
    expect(payload.requestType).toBe("WARRANTY");
    expect(payload.problemDescription).toBe("unit is not cooling");
    // Authority is the server's business. A client that could name the accepting user could name anyone.
    expect(payload.acceptedBy).toBeUndefined();
    expect(payload.actorUid).toBeUndefined();
    expect(payload.decisionAt).toBeUndefined();
    expect(payload.operatingCompanyId).toBeUndefined();
  });

  it("takes the reviewer to the Work Order acceptance created", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Accept Job" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/service/work-orders/wo-1"));
  });

  it("says why an acceptance was refused instead of failing silently", async () => {
    const accept = async () => ({ ok: false, code: "failed-precondition", message: "This request is DECLINED and can no longer be accepted." });
    render(<InboundWorkWorkspace source={makeSource({ accept })} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    fireEvent.click(await screen.findByRole("button", { name: "Accept Job" }));
    expect(await screen.findByText(/can no longer be accepted/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("offers no Accept control to a reviewer whose role excludes it", async () => {
    capabilities.value = new Set(["service.inboundWork.read"]);
    render(<InboundWorkWorkspace source={makeSource()} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    const accept = await screen.findByRole("button", { name: "Accept Job" });
    expect(accept.disabled).toBe(true);
    expect(screen.getByText(/not part of your role/i)).toBeTruthy();
  });


  it("says which attachments EOS actually holds, and which it could not retrieve", async () => {
    await open();
    const region = screen.getByRole("region", { name: "Original message" });
    expect(within(region).getByRole("button", { name: "Download" })).toBeTruthy();
    expect(within(region).getByText("Could not be retrieved")).toBeTruthy();
    expect(within(region).getByText(/one or more attachments could not be retrieved/i)).toBeTruthy();
  });

  it("downloading asks for the attachment by its PROVIDER id -- never by a storage key", async () => {
    const getAttachment = vi.fn(async () => ({
      ok: true,
      data: { filename: "authorization.pdf", declaredMimeType: "application/pdf", size: 3, contentBase64: "UERG" },
    }));
    render(<InboundWorkWorkspace source={makeSource({ getAttachment })} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    fireEvent.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() => expect(getAttachment).toHaveBeenCalledTimes(1));
    const payload = getAttachment.mock.calls[0][0];
    expect(payload).toEqual({ requestId: "req-1", providerAttachmentId: "att-1" });
    expect("storageKey" in payload).toBe(false);
  });

  it("says why a download failed instead of silently doing nothing", async () => {
    const getAttachment = async () => ({ ok: false, code: "failed-precondition", message: "That attachment has not been retrieved yet." });
    render(<InboundWorkWorkspace source={makeSource({ getAttachment })} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    fireEvent.click(await screen.findByRole("button", { name: "Download" }));
    expect(await screen.findByText(/has not been retrieved yet/)).toBeTruthy();
  });

  it("Decline Job carries a governed reason", async () => {
    const decline = vi.fn(async () => ({ ok: true, data: { requestId: "req-1", replayed: false } }));
    render(<InboundWorkWorkspace source={makeSource({ decline })} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    fireEvent.change(await screen.findByLabelText("Decline reason"), { target: { value: "CAPACITY" } });
    fireEvent.click(screen.getByRole("button", { name: "Decline Job" }));
    await waitFor(() => expect(decline).toHaveBeenCalledTimes(1));
    expect(decline.mock.calls[0][0].reason).toBe("CAPACITY");
  });
});
