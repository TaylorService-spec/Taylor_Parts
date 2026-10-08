// Service -> Inbound Work, rendered (vitest + jsdom). What this suite is actually for:
//
//   1. hostile message content arrives as TEXT and stays text -- no element is ever created from it;
//   2. the review screen shows the message and EOS's reading of it side by side;
//   3. Accept Job submits the REVIEWER'S confirmed values -- including the operating company the reviewer STATES --
//      and nothing else: no actor, no timestamp;
//   4. a role without the capability sees an honest denial, not an empty screen or a live button;
//   5. (Owner ruling W9) the source is the governed EOS intake: NOT_YET_ACTIVATED is said, never papered over.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const FULL_ACCESS = { canRead: true, canAccept: true, canDecline: true, canAttach: true, canManageIntake: false };
const access = { value: { ...FULL_ACCESS } };
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
  suggestedOperatingCompanyId: "ventana",
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
    { filename: "authorization.pdf", mimeType: "application/pdf", size: 2048, providerAttachmentId: "att-1", sourceMessageId: "msg-1", custody: "METADATA_ONLY" },
    { filename: "photo.jpg", mimeType: "image/jpeg", size: 4096, providerAttachmentId: "att-2", sourceMessageId: "msg-1", custody: "METADATA_ONLY" },
  ],
  attachmentCustody: "METADATA_ONLY",
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
    readAccess: async () => ({ status: "ready", payload: access.value, error: null }),
    listOperatingCompanies: async () => ({ status: "ready", payload: { items: [{ operatingCompanyId: "taylor" }, { operatingCompanyId: "ventana" }] }, error: null }),
    listQueue: async () => ({ status: "ready", payload: { rows: [row], truncated: false }, error: null }),
    getRequest: async () => ({ status: "ready", payload: detail, error: null }),
    accept: async () => ({ ok: true, data: { requestId: "req-1", workItemId: "wo-1", woNumber: "WO-2026-000001", replayed: false } }),
    decline: async () => ({ ok: true, data: { requestId: "req-1", replayed: false } }),
    attach: async () => ({ ok: true, data: { requestId: "req-1", workItemId: "wo-9", replayed: false } }),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  navigate.mockReset();
  access.value = { ...FULL_ACCESS };
});

describe("Inbound Work queue", () => {
  it("lists what arrived, with the sender and the routed request type", async () => {
    render(<InboundWorkWorkspace source={makeSource()} />);
    expect(await screen.findByText("dispatch@corporate.example")).toBeTruthy();
    expect(screen.getByText("Warranty service required")).toBeTruthy();
    // The stored token is WARRANTY; the queue says what a person reads.
    expect(screen.getByText("Warranty")).toBeTruthy();
  });

  it("says DENIED rather than showing an empty queue when the role does not include it", async () => {
    access.value = { canRead: false, canAccept: false, canDecline: false, canAttach: false, canManageIntake: false };
    render(<InboundWorkWorkspace source={makeSource()} />);
    expect(await screen.findByText(/isn't part of your role/i)).toBeTruthy();
  });

  it("says NOT_YET_ACTIVATED -- not an outage, not an empty queue -- while the EOS authority is off", async () => {
    render(<InboundWorkWorkspace source={makeSource({ readAccess: async () => ({ status: "not_activated", payload: null, error: "NOT_ACTIVATED" }) })} />);
    const notice = (await screen.findByText("Inbound Work: Not Yet Activated.")).closest("[data-inbound-work-readiness]");
    expect(notice.getAttribute("data-inbound-work-readiness")).toBe("NOT_YET_ACTIVATED");
    expect(screen.queryByText("Warranty service required")).toBeNull();
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
    await screen.findByRole("region", { name: "Original Message" });
  };

  it("shows the original message and the EOS interpretation together", async () => {
    await open();
    expect(screen.getByRole("region", { name: "Original Message" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "EOS Work Interpretation" })).toBeTruthy();
    expect(screen.getByText("WR-4471")).toBeTruthy();
    expect(screen.getByText("CASE-88213")).toBeTruthy();
    expect(screen.getByText("authorization.pdf")).toBeTruthy();
  });

  it("renders hostile message content as TEXT -- no element is created from it", async () => {
    await open();
    const region = screen.getByRole("region", { name: "Original Message" });
    expect(region.textContent).toContain('alert("xss")');
    expect(region.querySelector("img")).toBeNull();
    expect(region.querySelector("script")).toBeNull();
  });

  const chooseCompany = async (value = "taylor") => {
    const select = await screen.findByLabelText("Operating Company");
    await waitFor(() => expect(select.disabled).toBe(false));
    fireEvent.change(select, { target: { value } });
  };

  it("the operating company is STATED by the reviewer: never pre-filled from the suggestion, and Accept waits for it", async () => {
    await open();
    const select = await screen.findByLabelText("Operating Company");
    expect(select.value).toBe("");
    expect(screen.getByText("Suggested Operating Company").nextSibling.textContent).toBe("Ventana"); // SHOWN, not used
    expect(screen.getByRole("button", { name: "Accept Job" }).disabled).toBe(true);
    await chooseCompany();
    expect(screen.getByRole("button", { name: "Accept Job" }).disabled).toBe(false);
  });

  it("Accept Job submits the reviewer's confirmed values -- and no actor or timestamp", async () => {
    const accept = vi.fn(async () => ({ ok: true, data: { requestId: "req-1", workItemId: "wo-1", replayed: false } }));
    render(<InboundWorkWorkspace source={makeSource({ accept })} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    await chooseCompany();
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
    expect(payload.operatingCompanyId).toBe("taylor");
  });

  it("takes the reviewer to the Work Order acceptance created", async () => {
    await open();
    await chooseCompany();
    fireEvent.click(screen.getByRole("button", { name: "Accept Job" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/service/work-orders/wo-1"));
  });

  it("says why an acceptance was refused instead of failing silently", async () => {
    const accept = async () => ({ ok: false, code: "ALREADY_DECIDED", message: "This request is DECLINED and can no longer be accepted." });
    render(<InboundWorkWorkspace source={makeSource({ accept })} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    await chooseCompany();
    fireEvent.click(await screen.findByRole("button", { name: "Accept Job" }));
    expect(await screen.findByText(/can no longer be accepted/)).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("offers no Accept control to a reviewer whose role excludes it", async () => {
    access.value = { canRead: true, canAccept: false, canDecline: false, canAttach: false, canManageIntake: false };
    render(<InboundWorkWorkspace source={makeSource()} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    const accept = await screen.findByRole("button", { name: "Accept Job" });
    expect(accept.disabled).toBe(true);
    expect(screen.getByText(/not part of your role/i)).toBeTruthy();
  });


  it("says the attachment bytes are held by the mailbox provider -- and offers no download that cannot work", async () => {
    await open();
    const region = screen.getByRole("region", { name: "Original Message" });
    expect(within(region).getByText("authorization.pdf")).toBeTruthy();
    expect(within(region).getAllByText(/Held by the mailbox provider/).length).toBe(2);
    expect(within(region).queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("Decline Job carries a governed reason", async () => {
    const decline = vi.fn(async () => ({ ok: true, data: { requestId: "req-1", replayed: false } }));
    render(<InboundWorkWorkspace source={makeSource({ decline })} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    fireEvent.change(await screen.findByLabelText("Decline Reason"), { target: { value: "CAPACITY" } });
    fireEvent.click(screen.getByRole("button", { name: "Decline Job" }));
    await waitFor(() => expect(decline).toHaveBeenCalledTimes(1));
    expect(decline.mock.calls[0][0].reason).toBe("CAPACITY");
  });
});

// ── Controller SERVICE EXPERIENCE COMPLETION (2026-09-30): reviewer visibility and RELEASE / REASSIGN ──
describe("Inbound Work reviewer, history and recovery", () => {
  const stuck = {
    ...detail, status: "ACCEPTING", claimedByPrincipalId: "p-dana", claimedByName: "Dana Dispatch", claimedAt: 1756742700000,
    pendingWorkOrderId: "wo-carried",
    claimHistory: [{ kind: "CLAIMED", fromPrincipalId: null, fromName: null, toPrincipalId: "p-dana", toName: "Dana Dispatch", reason: null, at: 1756742700000 }],
  };
  const stuckRow = { ...row, status: "ACCEPTING", claimedByName: "Dana Dispatch", sourceMailboxName: "Warranty", threadMessageCount: 2, attachmentCount: 1, createdAt: 1756742640000 };

  it("the queue names the reviewer, the mailbox and the flags", async () => {
    render(<InboundWorkWorkspace source={makeSource({ listQueue: async () => ({ status: "ready", payload: { rows: [stuckRow], truncated: false }, error: null }) })} />);
    expect(await screen.findByText("Dana Dispatch")).toBeTruthy();
    expect(screen.getAllByText("Warranty", { selector: "td" }).some((td) => td.getAttribute("data-label") === "Mailbox")).toBe(true);
    expect(screen.getByText(/2 replies/)).toBeTruthy();
  });

  it("a Service Manager releases an unfinished accept with a reason; history is shown", async () => {
    access.value = { ...FULL_ACCESS, canRecover: true };
    const released = [];
    const source = makeSource({
      listQueue: async () => ({ status: "ready", payload: { rows: [stuckRow], truncated: false }, error: null }),
      getRequest: async () => ({ status: "ready", payload: stuck, error: null }),
      listRecoveryTargets: async () => ({ status: "ready", payload: { targets: [{ employeeId: "emp-drew", displayName: "Drew Dispatch" }] }, error: null }),
      release: async (input) => { released.push(input); return { ok: true, data: { status: "NEEDS_REVIEW" } }; },
      reassign: async () => ({ ok: true, data: {} }),
    });
    render(<InboundWorkWorkspace source={source} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    expect(await screen.findByText(/not yet finished/)).toBeTruthy();
    expect(screen.getByText(/A Work Order was already created/)).toBeTruthy();
    const release = screen.getByRole("button", { name: "Release to Queue" });
    expect(release.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "session ended" } });
    fireEvent.click(release);
    await waitFor(() => expect(released).toEqual([{ requestId: "req-1", reason: "session ended" }]));
    expect(await screen.findByRole("option", { name: "Drew Dispatch" })).toBeTruthy();
  });

  it("without recovery authority the history shows and no recovery control does", async () => {
    access.value = { ...FULL_ACCESS, canRecover: false };
    render(<InboundWorkWorkspace source={makeSource({ getRequest: async () => ({ status: "ready", payload: stuck, error: null }) })} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    expect(await screen.findByLabelText("Reviewer History")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Release to Queue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reassign" })).toBeNull();
  });

  it("custodied attachments say where the bytes are; an unsafe one says it was blocked", async () => {
    const withCustody = { ...detail, attachmentRefs: [
      { ...detail.attachmentRefs[0], custody: "STORED", attachmentId: "iwa_1" },
      { filename: "run.exe", mimeType: "application/octet-stream", size: 10, providerAttachmentId: "att-x", sourceMessageId: "msg-1", custody: "REFUSED_UNSAFE" },
    ] };
    render(<InboundWorkWorkspace source={makeSource({ getRequest: async () => ({ status: "ready", payload: withCustody, error: null }), readAttachment: async () => ({ status: "ready", payload: {} }) })} />);
    fireEvent.click(await screen.findByText("Warranty service required"));
    expect(await screen.findByText("Held in EOS")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(screen.getByText(/Blocked — unsafe attachment/)).toBeTruthy();
  });
});
