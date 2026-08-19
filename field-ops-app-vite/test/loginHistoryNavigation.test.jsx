// Login renders OUTSIDE BrowserRouter (App.jsx returns it before the router
// mounts), so the recovery view cannot be a route. It uses the History API
// directly instead. These tests pin that behaviour, because the failure mode is
// silent: nothing throws when Back stops working, the user simply leaves the app.
//
// Reported symptom: "you can't use the browser back button once you click on
// forgot password."
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Login from "../src/auth/Login";

const login = vi.fn();
const resetPassword = vi.fn(async () => ({ ok: true }));

vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ login, resetPassword }),
}));

// The shell reads the baked environment global; keep it out of the way.
vi.mock("../src/firebase/firebase", () => ({
  APP_ENVIRONMENT: { id: "platform-sandbox", role: "sandbox", deployment: "platform" },
}));

function setUrl(search) {
  window.history.replaceState({}, "", `/${search}`);
}

// Brand hierarchy is Owner-ruled and not interchangeable: Verenward (parent) /
// Enterprise Operations OS (platform) / Taylor Parts (implementation). The
// approved workspace badge is "Taylor Parts · Sandbox". An earlier draft
// rendered an invented "EOS" wordmark in parent position; these pin the ruling
// so that cannot silently return.
describe("Login brand hierarchy", () => {
  beforeEach(() => { setUrl(""); });

  it("renders all three tiers, with the workspace badge naming the environment", () => {
    render(<Login />);
    // The mark appears twice by design -- once in the brand panel and once in
    // the compact identity that replaces it below 860px. jsdom applies no CSS,
    // so both are in the tree here; assert presence, not uniqueness.
    expect(screen.getAllByText("VERENWARD").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enterprise Operations OS").length).toBeGreaterThan(0);
    // The mock supplies role: "sandbox", so the badge must carry BOTH halves --
    // the implementation and the environment.
    expect(screen.getAllByText("Taylor Parts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sandbox").length).toBeGreaterThan(0);
  });

  it("shows the approved headline and supporting copy", () => {
    render(<Login />);
    expect(screen.getByText("RUN THE OPERATION.")).toBeTruthy();
    expect(screen.getByText(/One connected system\./)).toBeTruthy();
  });

  it("does not promote the platform into parent-brand position", () => {
    const { container } = render(<Login />);
    // "EOS" as a standalone wordmark was the earlier mistake.
    expect(container.textContent).not.toMatch(/EOS/);
  });
});

describe("Login history navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUrl("");
  });

  it("pushes a history entry when entering recovery, so Back has something to return to", async () => {
    render(<Login />);
    expect(screen.getByRole("heading", { name: /welcome back/i })).toBeTruthy();

    const before = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));

    await waitFor(() => screen.getByRole("heading", { name: /reset your password/i }));
    expect(window.location.search).toContain("reset");
    // A pushed entry, not a replaced one: the sign-in view must still be behind us.
    expect(window.history.length).toBeGreaterThanOrEqual(before);
    expect(window.history.state?.eosAuthMode).toBe("recover");
  });

  it("returns to sign in when the browser fires popstate (the Back button)", async () => {
    render(<Login />);
    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    await waitFor(() => screen.getByRole("heading", { name: /reset your password/i }));

    // jsdom does not run the history stack for us; emulate what Back does:
    // restore the URL, then fire popstate.
    setUrl("");
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));

    await waitFor(() => expect(screen.getByRole("heading", { name: /welcome back/i })).toBeTruthy());
  });

  it("opens recovery directly from a shared ?reset link, so the view survives a refresh", async () => {
    setUrl("?reset=1");
    render(<Login />);
    expect(screen.getByRole("heading", { name: /reset your password/i })).toBeTruthy();
  });

  it("does not eject the user from the app when Back to sign in is used on a directly-opened link", async () => {
    setUrl("?reset=1");
    // No entry of ours behind this one -- history.back() here would leave the app.
    window.history.replaceState({}, "", "/?reset=1");
    render(<Login />);

    const backSpy = vi.spyOn(window.history, "back");
    fireEvent.click(screen.getByRole("button", { name: /back to sign in/i }));

    await waitFor(() => expect(screen.getByRole("heading", { name: /welcome back/i })).toBeTruthy());
    expect(backSpy).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain("reset");
    backSpy.mockRestore();
  });
});
