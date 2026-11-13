// AUTHENTICATOR SETUP (lane QR-SETUP). What is proved, with the REAL AccountSecurity / MfaEnrollmentGate / eosLoginClient (only fetch
// and the QR renderer are faked):
//   - the enrollment step draws a QR from the otpauth URI, in the browser, with alt text that does not contain the key;
//   - the tap link and the typed key stay as the fallback, and a failed QR shows a clear state, not a blank;
//   - the six-digit-code step and a refused code both tell the person to set the phone's clock to automatic;
//   - a session that owes a second factor sees the setup screen (and Sign out) instead of the app, finishes it, and the page reloads;
//   - App.jsx puts that gate ahead of every read the server would refuse.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("../src/auth/authSource.js", () => ({ EOS_AUTH_ONLY: true, resolveEosAuthOnly: () => true }));
vi.mock("../src/firebase/firebase", () => ({ auth: null, db: null, functions: null }));
vi.mock("../src/firebase/firebase.js", () => ({ auth: null, db: null, functions: null }));
vi.mock("firebase/auth", () => ({ onAuthStateChanged: () => () => {}, signOut: async () => {} }));

const qr = vi.hoisted(() => ({ toDataURL: vi.fn(async () => "data:image/png;base64,QUJD") }));
vi.mock("qrcode", () => ({ default: { toDataURL: (...a) => qr.toDataURL(...a) } }));

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const URI = `otpauth://totp/EOS:alex?secret=${SECRET}&issuer=EOS`;
const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const token = `${b64({ alg: "EdDSA", typ: "JWT", kid: "k" })}.${b64({ sub: "user.alex", exp: Math.floor(Date.now() / 1000) + 600 })}.${"s".repeat(86)}`;

const api = vi.hoisted(() => ({ calls: [], confirmed: false, accountFailsAfterConfirm: false }));
const fakeFetch = async (url) => {
  const path = new URL(url).pathname;
  api.calls.push(path);
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  switch (path) {
    case "/auth/login": return reply(200, { ok: true, status: "AUTHENTICATED", session: { accessToken: token, mfaEnrollmentRequired: true } });
    case "/auth/account":
      if (api.confirmed && api.accountFailsAfterConfirm) return reply(500, { ok: false, code: "UNAVAILABLE" });
      return reply(200, { ok: true, account: { loginIdentifier: "alex", factors: [], mfaRequired: true, mfaConfigured: true, sessions: [], recoveryCodesRemaining: 0 } });
    case "/auth/mfa/totp/begin": return reply(200, { ok: true, factorId: "f1", secret: SECRET, otpauthUri: URI });
    case "/auth/mfa/totp/confirm": api.confirmed = true; return reply(200, { ok: true, recoveryCodes: ["AAAA-1111", "BBBB-2222"] });
    case "/auth/logout": return reply(200, { ok: true });
    default: return reply(401, { ok: false, code: "SESSION_INVALID" }); // /auth/refresh at mount: no cookie session
  }
};

vi.mock("../src/auth/eosLoginClient.js", async () => {
  const actual = await vi.importActual("../src/auth/eosLoginClient.js");
  return {
    ...actual,
    eosHumanLoginEnabled: () => true,
    eosLoginClient: actual.createEosLoginClient({ fetchImpl: (u, i) => fakeFetch(u, i), baseUrl: "https://eos.test", locks: null }),
  };
});
vi.mock("../src/services/operationsApiClient.js", () => ({ operationsApiClient: { call: async () => ({ ok: false, code: "MFA_ENROLLMENT_REQUIRED" }) } }));
vi.mock("../src/services/workforceApiClient.js", () => ({ workforceApiClient: {} }));

import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { eosLoginClient, eosLoginMessage } from "../src/auth/eosLoginClient.js";
import { mfaGateActive, useMfaEnrollmentRequired } from "../src/auth/useMfaEnrollmentRequired.js";
import MfaEnrollmentGate from "../src/auth/MfaEnrollmentGate.jsx";
import AccountSecurity from "../src/modules/account/AccountSecurity.jsx";

beforeEach(async () => {
  await eosLoginClient.logout();
  api.calls.length = 0;
  api.confirmed = false;
  api.accountFailsAfterConfirm = false;
  qr.toDataURL.mockClear();
  qr.toDataURL.mockImplementation(async () => "data:image/png;base64,QUJD");
});
afterEach(() => cleanup());

async function signInAndBeginSetup() {
  await act(async () => { await eosLoginClient.login("alex", "pw"); });
  render(<AccountSecurity />);
  await screen.findByRole("button", { name: "Set up an authenticator app" });
  fireEvent.change(screen.getByLabelText("Your current password"), { target: { value: "a long password" } });
  fireEvent.click(screen.getByRole("button", { name: "Set up an authenticator app" }));
}

describe("authenticator enrollment step", () => {
  it("draws a QR from the otpauth URI, keeps the tap link and key as fallback, and gives the clock hint", async () => {
    await signInAndBeginSetup();
    const img = await screen.findByRole("img", { name: /QR code for adding this account/i });
    expect(qr.toDataURL).toHaveBeenCalledWith(URI, expect.any(Object));
    expect(img.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    expect(img.getAttribute("alt")).not.toContain(SECRET);
    expect(screen.getByText(/Google Authenticator/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open it in the authenticator app/ }).getAttribute("href")).toBe(URI);
    expect(screen.getByText(SECRET.match(/.{1,4}/g).join(" "))).toBeTruthy();
    expect(screen.getByText(/set your phone's date and time to automatic/)).toBeTruthy();
    // the key went to no network host: only /auth/* calls were made, and the QR renderer is in-browser
    expect(api.calls.every((p) => p.startsWith("/auth/"))).toBe(true);
  });

  it("says so, and keeps the fallback, when the QR cannot be generated", async () => {
    qr.toDataURL.mockImplementation(async () => { throw new Error("boom"); });
    await signInAndBeginSetup();
    expect((await screen.findByRole("alert")).textContent).toMatch(/QR code could not be shown/);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("link", { name: /Open it in the authenticator app/ })).toBeTruthy();
  });

  it("keeps the one-time recovery codes on screen when the reload after a successful confirm fails", async () => {
    api.accountFailsAfterConfirm = true;
    await signInAndBeginSetup();
    await screen.findByRole("img", { name: /QR code/ });
    fireEvent.change(screen.getByLabelText(/six-digit code/), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect((await screen.findByText(/AAAA-1111/)).textContent).toContain("BBBB-2222");
    expect(screen.getByRole("button", { name: "I have saved them" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Something went wrong/); // the load error is shown, not instead of the codes
    expect(screen.queryByRole("button", { name: "Set up an authenticator app" })).toBeNull();
  });

  it("a refused code tells the person to set the phone's date and time to automatic", () => {
    expect(eosLoginMessage("MFA_CODE_REFUSED")).toMatch(/authenticator app\. .*set your phone's date and time to automatic/);
  });
});

describe("a session that owes a second factor", () => {
  let reload;
  const realLocation = window.location;
  beforeEach(() => {
    reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
  });
  afterEach(() => Object.defineProperty(window, "location", { configurable: true, value: realLocation }));

  function Harness() {
    const { user } = useAuth();
    const required = useMfaEnrollmentRequired();
    if (mfaGateActive(required, user)) return <MfaEnrollmentGate />; // the same predicate App.jsx branches on
    return <div>{user ? "the app" : "signed out"}</div>;
  }

  it("sees the setup screen with Sign out instead of the app, finishes it, and the page reloads into the app", async () => {
    const auth = { current: null };
    function Capture() { auth.current = useAuth(); return null; }
    render(<AuthProvider><Capture /><Harness /></AuthProvider>);
    await screen.findByText("signed out");
    await act(async () => { await eosLoginClient.login("alex", "pw"); auth.current.eosSignedIn(); });
    expect(await screen.findByRole("heading", { name: "Set up two-step verification" })).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();

    fireEvent.change(await screen.findByLabelText("Your current password"), { target: { value: "a long password" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up an authenticator app" }));
    await screen.findByRole("img", { name: /QR code/ });
    fireEvent.change(screen.getByLabelText(/six-digit code/), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    fireEvent.click(await screen.findByRole("button", { name: "I have saved them" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("Sign out revokes the session and returns to sign-in", async () => {
    const auth = { current: null };
    function Capture() { auth.current = useAuth(); return null; }
    render(<AuthProvider><Capture /><Harness /></AuthProvider>);
    await screen.findByText("signed out");
    await act(async () => { await eosLoginClient.login("alex", "pw"); auth.current.eosSignedIn(); });
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await screen.findByText("signed out");
    expect(api.calls).toContain("/auth/logout");
  });

  it("App.jsx shows the gate ahead of every read the server would refuse", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    const gate = app.indexOf("<MfaEnrollmentGate />");
    expect(gate).toBeGreaterThan(0);
    // App branches on the exported predicate (the one the Harness above renders), not a private copy of the condition.
    expect(app).toMatch(/if \(mfaGateActive\(mfaEnrollmentRequired, user\)\) \{[\s\S]{0,200}<MfaEnrollmentGate \/>/);
    expect(mfaGateActive(true, { uid: "u" })).toBe(true);
    expect(mfaGateActive(true, null)).toBe(false);
    expect(mfaGateActive(false, { uid: "u" })).toBe(false);
    expect(gate).toBeLessThan(app.indexOf("if (loading) return"));
    expect(gate).toBeLessThan(app.indexOf("if (identityError)"));
  });
});
