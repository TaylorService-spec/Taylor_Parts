// SIGN OUT ON THE GOVERNED "NO ACCESS" SCREEN (Lane NOAS, UAT session recovery).
//
// A principal with no application area lands on NoAccessScreen, which has no rail and so used to have no Sign Out. What is proved,
// with the REAL AuthProvider, the REAL eosLoginClient (only its fetch is faked) and the real NoAccessScreen / EosLogin:
//   - the screen shows a visible, keyboard-reachable Sign Out button inside a landmark;
//   - clicking it runs the shared AuthContext.logout: POST /auth/logout is sent (server-side revocation, credentials included),
//     the in-memory session and every "eos." tab-storage key are cleared, and the sign-in page renders;
//   - it works with an EMPTY capability feed (the screen reads none) and with NO Firebase call;
//   - if the server call fails the client session is still cleared and sign-in renders (nothing half signed in);
//   - a DIFFERENT persona then resolves its own Principal/Employee and reaches its own shell, with nothing of the first left behind.
// Route-level denial for the General Employee is covered by the existing routing/navigation suites, run unchanged with this one.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";

const firebase = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  signOut: vi.fn(async () => {}),
  signInWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock("../src/auth/authSource.js", () => ({ EOS_AUTH_ONLY: true, resolveEosAuthOnly: () => true }));
vi.mock("../src/firebase/firebase", () => ({ auth: null, db: null, functions: null }));
vi.mock("../src/firebase/firebase.js", () => ({ auth: null, db: null, functions: null }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (...a) => firebase.onAuthStateChanged(...a),
  signOut: (...a) => firebase.signOut(...a),
  signInWithEmailAndPassword: (...a) => firebase.signInWithEmailAndPassword(...a),
  sendPasswordResetEmail: (...a) => firebase.sendPasswordResetEmail(...a),
}));

const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenFor = (sub) =>
  `${b64({ alg: "EdDSA", typ: "JWT", kid: "k" })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 600 })}.${"s".repeat(86)}`;

// The EOS API, faked at fetch. `logoutMode` makes /auth/logout fail (network) or succeed.
const api = vi.hoisted(() => ({ calls: [], logoutMode: "ok", next: "nonprod-persona.general" }));
const fakeFetch = async (url, init) => {
  const path = new URL(url).pathname;
  api.calls.push({ path, init });
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (path === "/auth/login") {
    return reply(200, { ok: true, status: "AUTHENTICATED", session: { accessToken: tokenFor(api.next), mfaEnrollmentRequired: false } });
  }
  if (path === "/auth/logout") {
    if (api.logoutMode === "network") throw new TypeError("network down");
    return reply(200, { ok: true });
  }
  return reply(401, { ok: false, code: "SESSION_INVALID" }); // /auth/refresh at mount: no cookie session
};

vi.mock("../src/auth/eosLoginClient.js", async () => {
  const actual = await vi.importActual("../src/auth/eosLoginClient.js");
  return {
    ...actual,
    eosHumanLoginEnabled: () => true,
    eosLoginClient: actual.createEosLoginClient({ fetchImpl: (u, i) => fakeFetch(u, i), baseUrl: "https://eos.test", locks: null }),
  };
});

// The governed answer, keyed by the signed-in subject (what the server resolves from the bearer).
const PERSONAS = {
  "nonprod-persona.general": { principalId: "p-general", employeeId: "emp-general", surfaces: [] },
  "nonprod-persona.dispatcher": { principalId: "p-dispatch", employeeId: "emp-dispatch", surfaces: ["dispatch"] },
};
const opsCall = vi.hoisted(() => vi.fn());
vi.mock("../src/services/operationsApiClient.js", () => ({ operationsApiClient: { call: (...a) => opsCall(...a) } }));
vi.mock("../src/services/workforceApiClient.js", () => ({ workforceApiClient: {} }));

import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { eosLoginClient } from "../src/auth/eosLoginClient.js";
import NoAccessScreen from "../src/auth/NoAccessScreen.jsx";
import EosLogin from "../src/auth/EosLogin.jsx";

let auth;
// App.jsx's gate, reduced to what the sign-out contract touches: signed out -> sign-in page; signed in with no area -> the real
// NoAccessScreen; signed in with an area -> a stand-in shell showing the resolved identity.
function Gate() {
  auth = useAuth();
  if (auth.loading) return <div>Loading...</div>;
  if (!auth.user) return <EosLogin />;
  const grant = PERSONAS[auth.user.uid];
  if (!grant || grant.surfaces.length === 0) return <NoAccessScreen email="general@sandbox.invalid" eosSource />;
  return <div data-testid="shell">{auth.employeeId}</div>;
}

async function signInAs(sub) {
  api.next = sub;
  await act(async () => {
    await eosLoginClient.login("someone", "pw");
    auth.eosSignedIn();
  });
}

beforeEach(async () => {
  await eosLoginClient.logout(); // the client is a module singleton: start every test with no session in memory
  sessionStorage.clear();
  api.calls.length = 0;
  api.logoutMode = "ok";
  for (const f of Object.values(firebase)) f.mockClear();
  opsCall.mockReset();
  opsCall.mockImplementation(async () => {
    const sub = eosLoginClient.currentSession()?.subject;
    const p = PERSONAS[sub];
    return p ? { ok: true, result: { tenantId: "t", ...p } } : { ok: false, code: "FORBIDDEN" };
  });
});
afterEach(() => cleanup());

async function mountSignedInAs(sub) {
  render(<AuthProvider><Gate /></AuthProvider>);
  await waitFor(() => expect(screen.getByLabelText("Sign-in name")).toBeTruthy());
  await signInAs(sub);
}

describe("Sign Out on the governed No Access screen", () => {
  it("a zero-area principal sees No access with a visible, focusable Sign Out inside a landmark", async () => {
    await mountSignedInAs("nonprod-persona.general");
    const heading = await screen.findByRole("heading", { name: "No access" });
    const button = screen.getByRole("button", { name: "Sign Out" });
    expect(button.tagName).toBe("BUTTON");
    expect(screen.getByRole("main").contains(button)).toBe(true);
    expect(screen.getByRole("main").getAttribute("aria-labelledby")).toBe(heading.id);
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("clicking it revokes the session server-side, clears the client session and shows the sign-in page", async () => {
    await mountSignedInAs("nonprod-persona.general");
    sessionStorage.setItem("eos.scan.activeWorkflow", "COUNT");
    sessionStorage.setItem("eos.session.v1", "stale");
    await screen.findByRole("heading", { name: "No access" });
    expect(eosLoginClient.currentSession()).not.toBeNull();
    api.calls.length = 0;

    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await waitFor(() => expect(screen.getByLabelText("Sign-in name")).toBeTruthy());

    const logout = api.calls.filter((c) => c.path === "/auth/logout");
    expect(logout).toHaveLength(1);
    expect(logout[0].init.method).toBe("POST");
    expect(logout[0].init.credentials).toBe("include"); // the HttpOnly refresh cookie is what the server revokes
    expect(eosLoginClient.currentSession()).toBeNull();
    expect(auth.user).toBeNull();
    expect(auth.employeeId).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(screen.queryByRole("heading", { name: "No access" })).toBeNull();
    expect(firebase.signOut).not.toHaveBeenCalled();
    expect(firebase.onAuthStateChanged).not.toHaveBeenCalled();
  });

  it("works when the capability feed is empty or never loaded (the screen reads none)", async () => {
    await mountSignedInAs("nonprod-persona.general");
    await screen.findByRole("heading", { name: "No access" });
    // Only the identity read happened; no capability-feed operation was ever made for this principal.
    expect(opsCall.mock.calls.every(([op]) => op === "resolveMyExperienceContext")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await waitFor(() => expect(screen.getByLabelText("Sign-in name")).toBeTruthy());
  });

  it("still ends the client session and lands on sign-in when the server call fails", async () => {
    await mountSignedInAs("nonprod-persona.general");
    await screen.findByRole("heading", { name: "No access" });
    api.logoutMode = "network";
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await waitFor(() => expect(screen.getByLabelText("Sign-in name")).toBeTruthy());
    expect(eosLoginClient.currentSession()).toBeNull();
    expect(auth.user).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("a different persona then resolves its OWN Principal and Employee, with nothing of the first left behind", async () => {
    await mountSignedInAs("nonprod-persona.general");
    await screen.findByRole("heading", { name: "No access" });
    expect(auth.employeeId).toBe("emp-general");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await waitFor(() => expect(screen.getByLabelText("Sign-in name")).toBeTruthy());
    expect(auth.employeeId).toBeNull();

    await signInAs("nonprod-persona.dispatcher");
    await waitFor(() => expect(screen.getByTestId("shell").textContent).toBe("emp-dispatch"));
    expect(auth.user.uid).toBe("nonprod-persona.dispatcher");
    expect(screen.queryByText(/emp-general/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "No access" })).toBeNull();
  });
});

describe("Sign Out path guards", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const importsOf = (src) => [...src.matchAll(/^\s*import[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

  it("the sign-out path imports nothing from firebase/* and no AI / assistant / capability-feed module", () => {
    for (const file of ["../src/auth/NoAccessScreen.jsx", "../src/auth/eosLoginClient.js", "../src/auth/eosSession.js"]) {
      for (const spec of importsOf(read(file))) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/(^|\/)firebase(\/|$)/);
        expect(spec, `${file} imports ${spec}`).not.toMatch(/\b(ai|assistant|copilot)\b/i);
        expect(spec, `${file} imports ${spec}`).not.toMatch(/useEosCapabilityFeed|useReportCapabilities|useExperienceContext/);
      }
    }
  });

  it("App.jsx renders NoAccessScreen for a principal with no area, and that screen calls the shared logout", () => {
    const app = read("../src/App.jsx");
    expect(app).toMatch(/if \(!hasAnyAccess\) \{[\s\S]{0,200}<NoAccessScreen/);
    expect(read("../src/auth/NoAccessScreen.jsx")).toMatch(/const \{ logout \} = useAuth\(\)/);
    expect(read("../src/navigation/AppRail.jsx")).toMatch(/logout/);
  });
});
