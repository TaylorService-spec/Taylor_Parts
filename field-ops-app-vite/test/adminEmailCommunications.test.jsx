// Administration -> Email & Communications, rendered (vitest + jsdom).
//
// WHAT THIS SUITE IS FOR: the screen must speak, not dump. A connection's provider, a delivery failure's
// mailbox and a routing rule's condition are all stored as identifiers -- `GOOGLE_WORKSPACE`,
// `sbx-mb-warranty`, `{"senderDomain":"corporate.example"}` -- and an administrator reading the page is
// entitled to words. These assertions fail the moment a raw enum or a document id reaches the screen.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "admin-uid" } }) }));
vi.mock("../src/access/useGovernedCapabilities.js", () => ({
  useGovernedCapabilities: () => ({ hasCapability: () => true, accessVersion: 1 }),
}));

const AdminEmailCommunications = (await import("../src/modules/administration/AdminEmailCommunications.jsx")).default;
const { SOURCE_STATUS } = await import("../src/access/inboundWorkSource.js");

const config = {
  connections: [
    {
      id: "conn-google",
      connectionName: "Taylor Workspace",
      provider: "GOOGLE_WORKSPACE",
      connectedAccount: "service@sandbox.example",
      oauthStatus: "PENDING_AUTHORIZATION",
      health: "UNKNOWN",
      authorizedAt: null,
      lastMessageReceived: null,
      providerErrorCode: null,
    },
  ],
  mailboxes: [{ id: "mb-warranty", displayName: "Warranty", emailAddress: "warranty@sandbox.example", purpose: "WARRANTY" }],
  rules: [
    {
      id: "rule-1",
      name: "Corporate warranty requests",
      order: 10,
      enabled: true,
      when: { mailboxId: "mb-warranty", senderDomain: "corporate.example" },
      then: { requestType: "WARRANTY", manualReview: true },
    },
  ],
  exceptions: [
    {
      id: "fail-1",
      mailboxId: "mb-warranty",
      code: "MAILBOX_ACCESS_DENIED",
      detail: "raw detail",
      attempts: 5,
      exhausted: true,
      lastFailedAt: Date.now() - 3_600_000,
    },
  ],
  overview: { total: 1, byStatus: { NEEDS_REVIEW: 1 }, attachmentCustody: { PARTIAL: 1 } },
};

const source = {
  getConfiguration: async () => ({ status: SOURCE_STATUS.READY, payload: config }),
  getProviderReadiness: async () => ({
    status: SOURCE_STATUS.READY,
    payload: { microsoftConfigured: false, googleConfigured: false, transportAvailable: true, productionRefusal: "" },
  }),
};

const show = async (tab) => {
  render(<AdminEmailCommunications source={source} />);
  fireEvent.click((await screen.findAllByRole("tab")).find((t) => t.textContent === tab));
};

afterEach(cleanup);

describe("Email & Communications reads in words", () => {
  it("names the provider rather than printing its stored token", async () => {
    await show("Connections");
    expect(await screen.findByText(/Google Workspace · service@sandbox.example/)).toBeTruthy();
    expect(screen.getByText("Awaiting consent")).toBeTruthy();
    expect(screen.queryByText(/GOOGLE_WORKSPACE|PENDING_AUTHORIZATION/)).toBeNull();
  });

  it("states a routing rule as a sentence, naming the mailbox it matches", async () => {
    await show("Routing Rules");
    expect(await screen.findByText("mailbox is Warranty and sender domain is corporate.example")).toBeTruthy();
    expect(screen.getByText("classify as Warranty, hold for review")).toBeTruthy();
  });

  it("says what a delivery failure needs, against the mailbox's name and not its id", async () => {
    await show("Exceptions");
    expect(await screen.findByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("The connected account cannot read that mailbox. Grant it access, then retry.")).toBeTruthy();
    expect(screen.queryByText("mb-warranty")).toBeNull();
  });
});
