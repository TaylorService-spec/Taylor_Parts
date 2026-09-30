// CUSTOMER SELF-SCHEDULING -- the customer's page, rendered (vitest + jsdom). Deliberately simple, and honest:
//   1. the visit is recognizable (customer, site, what's wrong, how long) and carries no identifier;
//   2. times are grouped by day; one choice; Book;
//   3. a time taken meanwhile is refused IN PLACE with the refreshed choices -- the stale time is gone;
//   4. the confirmation; an expired link says so in a sentence.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import CustomerSchedulingPage from "../src/modules/selfScheduling/CustomerSchedulingPage.jsx";

const TOKEN = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
const slot = (iso, dateLabel, timeLabel) => ({ slotStart: iso, slotEnd: iso, dateLabel, timeLabel });
const OFFER = {
  status: "OPEN", expiresAt: "2026-10-10T00:00:00.000Z", timeZone: "America/Phoenix",
  job: { customerName: "Summit Grill", siteName: "Summit Kitchen", siteAddress: "4 Ridge Rd, Concord", visitType: "SERVICE_CALL",
    problemSummary: "walk-in cooler warm", visitMinutes: 60 },
  slots: [slot("2026-10-05T16:00:00.000Z", "Monday, October 5", "9:00 AM"), slot("2026-10-05T17:00:00.000Z", "Monday, October 5", "10:00 AM"),
    slot("2026-10-06T16:00:00.000Z", "Tuesday, October 6", "9:00 AM")],
};

afterEach(cleanup);

describe("customer scheduling page", () => {
  it("shows the visit and the times by day, then books the choice", async () => {
    const selected = [];
    const client = {
      readOffer: async () => ({ ok: true, result: OFFER }),
      select: async (token, slotStart) => { selected.push([token, slotStart]); return { ok: true, result: { status: "CONFIRMED", dateLabel: "Tuesday, October 6", timeLabel: "9:00 AM" } }; },
    };
    render(<CustomerSchedulingPage token={TOKEN} client={client} />);
    expect(await screen.findByText(/Summit Grill/)).toBeTruthy();
    expect(screen.getByText(/4 Ridge Rd, Concord/)).toBeTruthy();
    expect(screen.getByText("Monday, October 5")).toBeTruthy();
    expect(screen.getByText("Tuesday, October 6")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("9:00 AM")[1]);
    fireEvent.click(screen.getByRole("button", { name: /Book Tuesday, October 6 at 9:00 AM/ }));
    expect(await screen.findByText(/You're booked/)).toBeTruthy();
    expect(selected).toEqual([[TOKEN, "2026-10-06T16:00:00.000Z"]]);
  });

  it("a time taken meanwhile is refused in place, with fresh times and without the stale one", async () => {
    const client = {
      readOffer: async () => ({ ok: true, result: OFFER }),
      select: async () => ({ ok: false, code: "SLOT_NO_LONGER_AVAILABLE", refreshed: { slots: [OFFER.slots[2]] } }),
    };
    render(<CustomerSchedulingPage token={TOKEN} client={client} />);
    fireEvent.click((await screen.findAllByLabelText("10:00 AM"))[0]);
    fireEvent.click(screen.getByRole("button", { name: /Book/ }));
    expect(await screen.findByText(/That time was just taken/)).toBeTruthy();
    expect(screen.queryByText("Monday, October 5")).toBeNull();
    expect(screen.getByText("Tuesday, October 6")).toBeTruthy();
  });

  it("an expired link says so, plainly", async () => {
    render(<CustomerSchedulingPage token={TOKEN} client={{ readOffer: async () => ({ ok: false, code: "SESSION_EXPIRED" }), select: async () => ({}) }} />);
    expect(await screen.findByText(/This scheduling link has expired/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Book/ })).toBeNull();
  });

  it("an already-booked link reads as its confirmation", async () => {
    render(<CustomerSchedulingPage token={TOKEN} client={{ readOffer: async () => ({ ok: true, result: { status: "CONFIRMED", dateLabel: "Monday, October 5", timeLabel: "9:00 AM" } }), select: async () => ({}) }} />);
    expect(await screen.findByText(/You're booked/)).toBeTruthy();
    expect(screen.getByText(/Monday, October 5 at 9:00 AM/)).toBeTruthy();
  });
});
