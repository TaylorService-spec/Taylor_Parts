// THE ADDITIVE EOS SESSION IN THE CLIENT -- token source, AuthContext and harness seeding, proved in jsdom.
// docs/architecture/eos-identity-session-foundation.md, section 3(e), proof 13.
//
// Firebase is MOCKED: nothing here initializes an SDK or reaches a network. The EOS API is a fake Operations
// client seam. What is proved:
//   - with an EOS token in sessionStorage, AuthContext is SIGNED IN, never subscribes to Firebase, and takes the
//     Principal/Employee from the EOS API's resolveMyExperienceContext;
//   - with none, the Firebase path runs exactly as before (onAuthStateChanged is subscribed);
//   - the one client token source (currentIdToken) sends the EOS token when present and Firebase's otherwise;
//   - an expired, malformed or non-EdDSA token is dropped, and a PRODUCTION build ignores an EOS session;
//   - logout clears the EOS session.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

const firebaseAuth = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  signOut: vi.fn(async () => {}),
  currentUser: null,
}));
vi.mock("../src/firebase/firebase", () => ({ auth: firebaseAuth, db: {}, functions: {} }));
vi.mock("../src/firebase/firebase.js", () => ({ auth: firebaseAuth, db: {}, functions: {} }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (...a) => firebaseAuth.onAuthStateChanged(...a),
  signOut: (...a) => firebaseAuth.signOut(...a),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
}));
const opsCall = vi.hoisted(() => vi.fn());
vi.mock("../src/services/operationsApiClient.js", () => ({ operationsApiClient: { call: (...a) => opsCall(...a) } }));
vi.mock("../src/auth/employeeSession", () => ({ resolveEmployeeSession: vi.fn(), buildEmployeeSessionResult: vi.fn() }));

import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { EOS_SESSION_STORAGE_KEY, readEosSession, currentEosSessionToken } from "../src/auth/eosSession.js";
import { resolveEosSessionIdentity } from "../src/auth/eosSessionIdentity.js";
import { currentIdToken } from "../src/services/adminPolicyApiClient.js";

const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fakeToken = (over = {}, header = { alg: "EdDSA", typ: "JWT", kid: "nonprod-k" }) =>
  `${b64(header)}.${b64({ iss: "i", aud: "a", sub: "nonprod-persona.dispatcher", iat: 1, exp: Math.floor(Date.now() / 1000) + 600, jti: "j".repeat(22), env: "nonprod", ...over })}.${"s".repeat(86)}`;

function Probe() {
  const a = useAuth();
  return (
    <div>
      <span data-testid="signed-in">{a.user ? "yes" : "no"}</span>
      <span data-testid="source">{a.user?.identitySource ?? "firebase"}</span>
      <span data-testid="loading">{a.loading ? "loading" : "ready"}</span>
      <span data-testid="employee">{a.employeeId ?? "none"}</span>
      <span data-testid="role">{a.role ?? "null"}</span>
      <span data-testid="error">{a.identityError ?? ""}</span>
      <button onClick={() => a.logout()}>logout</button>
    </div>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  firebaseAuth.onAuthStateChanged.mockClear();
  firebaseAuth.signOut.mockClear();
  firebaseAuth.currentUser = null;
  opsCall.mockReset();
});
afterEach(() => sessionStorage.clear());

describe("EOS session token source", () => {
  it("reads a valid EOS token and drops expired, malformed and non-EdDSA ones", () => {
    sessionStorage.setItem(EOS_SESSION_STORAGE_KEY, fakeToken());
    expect(readEosSession()?.subject).toBe("nonprod-persona.dispatcher");
    for (const bad of [fakeToken({ exp: 10 }), "a.b", "x.y.z", fakeToken({}, { alg: "RS256", typ: "JWT" }), fakeToken({ sub: "bad sub" })]) {
      sessionStorage.setItem(EOS_SESSION_STORAGE_KEY, bad);
      expect(readEosSession()).toBeNull();
      expect(sessionStorage.getItem(EOS_SESSION_STORAGE_KEY)).toBeNull();
    }
  });

  it("is refused outright by a PRODUCTION build", () => {
    sessionStorage.setItem(EOS_SESSION_STORAGE_KEY, fakeToken());
    expect(readEosSession({ environmentRole: "production" })).toBeNull();
    expect(currentEosSessionToken({ environmentRole: "sandbox" })).toBe(sessionStorage.getItem(EOS_SESSION_STORAGE_KEY));
  });

  it("currentIdToken sends the EOS token when present, and the Firebase ID token otherwise", async () => {
    firebaseAuth.currentUser = { getIdToken: vi.fn(async () => "firebase-id-token") };
    expect(await currentIdToken()).toBe("firebase-id-token");
    const eos = fakeToken();
    sessionStorage.setItem(EOS_SESSION_STORAGE_KEY, eos);
    expect(await currentIdToken()).toBe(eos);
    expect(firebaseAuth.currentUser.getIdToken).toHaveBeenCalledTimes(1);
  });

  it("identity resolution comes from the EOS API, never a frontend role map", async () => {
    const call = vi.fn(async () => ({ ok: true, result: { tenantId: "t", principalId: "p-1", employeeId: "e-1", securityRoleKeys: ["admin"], surfaces: [] } }));
    const id = await resolveEosSessionIdentity({ call });
    expect(call).toHaveBeenCalledWith("resolveMyExperienceContext");
    expect(id).toMatchObject({ principalId: "p-1", employeeId: "e-1", role: null });
    await expect(resolveEosSessionIdentity({ call: async () => ({ ok: false, code: "FORBIDDEN", reason: "FORBIDDEN" }) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("AuthContext", () => {
  it("13. an EOS session is SIGNED IN, identity comes from the EOS API, and Firebase auth state is never subscribed", async () => {
    sessionStorage.setItem(EOS_SESSION_STORAGE_KEY, fakeToken());
    opsCall.mockResolvedValue({ ok: true, result: { tenantId: "t", principalId: "p-dispatch", employeeId: "synthetic-np-emp-dispatcher", securityRoleKeys: ["dispatcher"], surfaces: ["dispatch"] } });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByTestId("signed-in").textContent).toBe("yes");
    expect(screen.getByTestId("source").textContent).toBe("eos");
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("ready"));
    expect(screen.getByTestId("employee").textContent).toBe("synthetic-np-emp-dispatcher");
    expect(screen.getByTestId("role").textContent).toBe("null");
    expect(opsCall).toHaveBeenCalledWith("resolveMyExperienceContext");
    expect(firebaseAuth.onAuthStateChanged).not.toHaveBeenCalled();
  });

  it("a refused EOS session stays signed in with NO identity (fail closed, no fallback role)", async () => {
    sessionStorage.setItem(EOS_SESSION_STORAGE_KEY, fakeToken());
    opsCall.mockResolvedValue({ ok: false, code: "FORBIDDEN", reason: "FORBIDDEN", message: "EMPLOYEE_NOT_ACCESS_ELIGIBLE" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("ready"));
    expect(screen.getByTestId("employee").textContent).toBe("none");
    expect(screen.getByTestId("error").textContent).toMatch(/could not be loaded/);
    // The log line carries a code, never the token.
    for (const call of err.mock.calls) expect(JSON.stringify(call)).not.toContain(sessionStorage.getItem(EOS_SESSION_STORAGE_KEY));
    err.mockRestore();
  });

  it("with NO EOS session the Firebase path is unchanged (onAuthStateChanged subscribed)", () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(firebaseAuth.onAuthStateChanged).toHaveBeenCalledTimes(1);
    expect(opsCall).not.toHaveBeenCalled();
  });

  it("logout clears the EOS session and signs Firebase out", async () => {
    sessionStorage.setItem(EOS_SESSION_STORAGE_KEY, fakeToken());
    opsCall.mockResolvedValue({ ok: true, result: { tenantId: "t", principalId: "p", employeeId: null, surfaces: [] } });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("ready"));
    await act(async () => { screen.getByText("logout").click(); });
    expect(sessionStorage.getItem(EOS_SESSION_STORAGE_KEY)).toBeNull();
    expect(firebaseAuth.signOut).toHaveBeenCalled();
    await waitFor(() => expect(firebaseAuth.onAuthStateChanged).toHaveBeenCalled());
  });
});
