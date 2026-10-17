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
import { render, renderHook, screen, waitFor, act, cleanup } from "@testing-library/react";

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
import { resolveEosEmployeeSession } from "../src/auth/eosEmployeeSession.js";
import { EOS_CAPABILITY_STATE, EOS_ACCESS_CHANGED_EVENT, useEosCapabilityFeed } from "../src/access/useEosCapabilityFeed.js";
import { useReportCapabilities } from "../src/access/useReportCapabilities.js";
import { useAccountPageCapabilityDecisions } from "../src/metadata/definitions/accountPageComponents.js";
import { useCurrentTechnician } from "../src/hooks/useCurrentTechnician.js";
import { notifyEosAccessChanged } from "../src/access/eosAccessEvents.js";

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

// ════════════════════ FIREBASE EXIT F1 (DECISIONS #244): THE SESSION FEED, FROM EOS ════════════════════
// Where an EOS API is declared the person still signs in through Firebase, but identity, capabilities and the technician link
// come from EOS -- one-shot reads, refetched on focus / route / role change, a failed or slow read a SETTLED deny. The flag is
// a compile-time constant (false in this suite), so each hook is driven through its own `eosSource` seam.
const caps = (...capabilities) => ({ ok: true, operation: "resolveMyCapabilities", result: { tenantId: "t", uid: "p", heldRoleKeys: [], capabilities } });
const clientSequence = (...answers) => {
  let i = 0;
  return { call: vi.fn(async () => { const a = answers[Math.min(i, answers.length - 1)]; i += 1; return typeof a === "function" ? a() : a; }) };
};

describe("F1 identity: resolveEosEmployeeSession (experience context + employee profile)", () => {
  const operations = (answer) => ({ call: vi.fn(async () => answer) });
  const workforce = (answer) => ({ call: vi.fn(async () => answer) });
  const linked = { ok: true, result: { tenantId: "t", principalId: "p", employeeId: "e1", surfaces: [] } };

  it("a linked principal gets employeeId, displayName and employmentStatus from EOS; role is null and there are no legacy roles", async () => {
    const wf = workforce({ ok: true, result: { employee: { employeeId: "e1", displayName: "Dana Dispatcher", employmentStatus: "ACTIVE" } } });
    const session = await resolveEosEmployeeSession({ operations: operations(linked), workforce: wf });
    expect(session).toEqual({ role: null, employeeId: "e1", displayName: "Dana Dispatcher", employmentStatus: "ACTIVE" });
    expect("operationalRoles" in session).toBe(false); // no legacy role list is returned; AuthContext holds the empty default
    expect(wf.call.mock.calls[0][0]).toBe("readMyEmployeeProfile");
  });

  it("an UNLINKED principal (no employeeId) is a null identity and makes no profile read", async () => {
    const wf = workforce({ ok: true, result: {} });
    const session = await resolveEosEmployeeSession({ operations: operations({ ok: true, result: { ...linked.result, employeeId: null } }), workforce: wf });
    expect(session).toMatchObject({ role: null, employeeId: null, displayName: null, employmentStatus: null });
    expect(wf.call).not.toHaveBeenCalled();
  });

  it("a profile refused 404 / 409 / 412 is a null identity (employeeId kept), NOT an identity error", async () => {
    for (const code of ["NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED"]) {
      const session = await resolveEosEmployeeSession({ operations: operations(linked), workforce: workforce({ ok: false, code, status: 404 }) });
      expect(session).toMatchObject({ role: null, employeeId: "e1", displayName: null, employmentStatus: null });
    }
  });

  it("a refused Principal (403) is a null identity -- an answer about the person, not a fault", async () => {
    const session = await resolveEosEmployeeSession({ operations: operations({ ok: false, code: "FORBIDDEN" }), workforce: workforce({ ok: true, result: {} }) });
    expect(session).toMatchObject({ role: null, employeeId: null, displayName: null });
  });

  it("an unreachable / failing / malformed service THROWS (AuthContext renders the retryable error, never a default role)", async () => {
    await expect(resolveEosEmployeeSession({ operations: operations({ ok: false, code: "UNREACHABLE", message: "down" }), workforce: workforce({}) })).rejects.toMatchObject({ code: "UNREACHABLE" });
    await expect(resolveEosEmployeeSession({ operations: operations({ ok: false, code: "INTERNAL" }), workforce: workforce({}) })).rejects.toThrow();
    await expect(resolveEosEmployeeSession({ operations: operations({ ok: true, result: { employeeId: 7 } }), workforce: workforce({}) })).rejects.toMatchObject({ code: "MALFORMED_RESULT" });
    await expect(resolveEosEmployeeSession({ operations: operations(linked), workforce: workforce({ ok: false, code: "INTERNAL", status: 500 }) })).rejects.toThrow();
  });

  it("a read that never answers is bounded: it is an UNREACHABLE fault (the retryable identity error), for either read", async () => {
    const never = { call: vi.fn(() => new Promise(() => {})) };
    await expect(resolveEosEmployeeSession({ operations: never, workforce: workforce({}), timeoutMs: 30 })).rejects.toMatchObject({ code: "UNREACHABLE" });
    // the abort signal is handed to the client so a real fetch is cancelled
    expect(never.call.mock.calls[0][1]).toHaveProperty("signal");
    const slowProfile = { call: vi.fn(() => new Promise(() => {})) };
    await expect(resolveEosEmployeeSession({ operations: operations(linked), workforce: slowProfile, timeoutMs: 30 })).rejects.toMatchObject({ code: "UNREACHABLE" });
    expect(slowProfile.call.mock.calls[0][2]).toHaveProperty("signal");
  });

  it("AuthContext picks the EOS resolver ONLY behind the compile-time flag, and never falls back on failure", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/auth/AuthContext.jsx"), "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain("EOS_SESSION_SOURCE\n          ? await resolveEosEmployeeSession({ operations: operationsApiClient, workforce: workforceApiClient })\n          : await resolveEmployeeSession(u.uid)");
    // the only other mention is the re-export; there is no second attempt against Firestore in the catch block
    expect(src.match(/await resolveEmployeeSession\(/g).length).toBe(1);
  });
});

describe("F1 capability feed: one-shot, refetched on events, settled deny", () => {
  afterEach(() => cleanup());

  it("asks resolveMyCapabilities once, holds exactly what the answer lists, and translates only same-meaning Firebase ids", async () => {
    const client = clientSequence(caps("customer.record.read", "inboundWork.request.read", "finance.invoice.read", "reportDefinition.read"));
    const { result } = renderHook(() => useEosCapabilityFeed({ uid: "u1" }, { client }));
    expect(result.current.status).toBe(EOS_CAPABILITY_STATE.LOADING);
    expect(result.current.hasCapability("customer.record.read")).toBe(false); // loading holds nothing
    await waitFor(() => expect(result.current.status).toBe(EOS_CAPABILITY_STATE.READY));
    expect(client.call).toHaveBeenCalledTimes(1);
    expect(client.call.mock.calls[0][0]).toBe("resolveMyCapabilities");
    expect(result.current.hasCapability("customer.record.read")).toBe(true);
    expect(result.current.hasCapability("service.inboundWork.read")).toBe(true); // -> inboundWork.request.read
    expect(result.current.hasCapability("finance.read")).toBe(true); // -> finance.invoice.read (Owner split, credEquivalence.ts)
    expect(result.current.hasCapability("report.definition.read")).toBe(true); // -> reportDefinition.read
    expect(result.current.hasCapability("report.definition.create")).toBe(false); // no EOS twin: denied, never inferred
    expect(result.current.hasCapability("admin.userStatus.write")).toBe(false);
  });

  it("a failed, refused, malformed or never-answering read is a SETTLED deny -- never an infinite Loading", async () => {
    for (const answer of [{ ok: false, code: "FORBIDDEN" }, { ok: false, code: "UNREACHABLE" }, { ok: true, result: { capabilities: "x" } }, { ok: true, result: null }]) {
      const { result, unmount } = renderHook(() => useEosCapabilityFeed({ uid: "u1" }, { client: clientSequence(answer) }));
      await waitFor(() => expect(result.current.status).toBe(EOS_CAPABILITY_STATE.FAILED));
      expect(result.current.hasCapability("customer.record.read")).toBe(false);
      unmount();
    }
    const never = { call: vi.fn(() => new Promise(() => {})) };
    const { result } = renderHook(() => useEosCapabilityFeed({ uid: "u1" }, { client: never, timeoutMs: 30 }));
    expect(result.current.status).toBe(EOS_CAPABILITY_STATE.LOADING);
    await waitFor(() => expect(result.current.status).toBe(EOS_CAPABILITY_STATE.FAILED));
  });

  it("makes NO request when disabled or signed out", async () => {
    const client = clientSequence(caps("customer.record.read"));
    renderHook(() => useEosCapabilityFeed({ uid: "u1" }, { client, enabled: false }));
    renderHook(() => useEosCapabilityFeed(null, { client }));
    await new Promise((r) => setTimeout(r, 20));
    expect(client.call).not.toHaveBeenCalled();
  });

  it("refetches on a governed role change at once, and on window focus only past the throttle -- and never on a timer", async () => {
    const client = clientSequence(caps("a.one"), caps("a.one"), caps("a.one", "b.two"));
    const { result } = renderHook(() => useEosCapabilityFeed({ uid: "u1" }, { client, throttleMs: 400 }));
    await waitFor(() => expect(result.current.status).toBe(EOS_CAPABILITY_STATE.READY));
    expect(result.current.version).toBe(0);
    // a focus inside the throttle window is NOT a second request
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(client.call).toHaveBeenCalledTimes(1);
    // past it, focus re-reads; the SAME set keeps the SAME version (nothing re-keys)
    await new Promise((r) => setTimeout(r, 450));
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(client.call).toHaveBeenCalledTimes(2));
    expect(result.current.version).toBe(0);
    // a governed role change is never throttled; a CHANGED set advances the version
    act(() => { notifyEosAccessChanged(); });
    await waitFor(() => expect(result.current.hasCapability("b.two")).toBe(true));
    expect(client.call).toHaveBeenCalledTimes(3);
    expect(result.current.version).toBe(1);
    expect(EOS_ACCESS_CHANGED_EVENT).toBe("eos:access-changed");
    // no polling: nothing else happens while idle
    await new Promise((r) => setTimeout(r, 150));
    expect(client.call).toHaveBeenCalledTimes(3);
  });

  it("an UNCHANGED capability set keeps the prior Set and the function identities (nothing memoised on them re-runs)", async () => {
    const client = clientSequence(caps("a.one", "b.two"), caps("b.two", "a.one"), caps("a.one"));
    const { result } = renderHook(() => useEosCapabilityFeed({ uid: "u1" }, { client }));
    await waitFor(() => expect(result.current.status).toBe(EOS_CAPABILITY_STATE.READY));
    const { held, hasEosKey, hasCapability } = result.current;
    act(() => { notifyEosAccessChanged(); });
    await waitFor(() => expect(client.call).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.held).toBe(held);
    expect(result.current.hasEosKey).toBe(hasEosKey);
    expect(result.current.hasCapability).toBe(hasCapability);
    expect(result.current.version).toBe(0);
    // a CHANGED set replaces them
    act(() => { notifyEosAccessChanged(); });
    await waitFor(() => expect(result.current.hasCapability("b.two")).toBe(false));
    expect(result.current.held).not.toBe(held);
    expect(result.current.version).toBe(1);
  });

  it("a refetch that FAILS denies (no stale grant is kept)", async () => {
    const client = clientSequence(caps("a.one"), { ok: false, code: "UNREACHABLE" });
    const { result } = renderHook(() => useEosCapabilityFeed({ uid: "u1" }, { client }));
    await waitFor(() => expect(result.current.hasCapability("a.one")).toBe(true));
    act(() => { notifyEosAccessChanged(); });
    await waitFor(() => expect(result.current.status).toBe(EOS_CAPABILITY_STATE.FAILED));
    expect(result.current.hasCapability("a.one")).toBe(false);
  });

  it("a previous principal's answer is never shown to the next", async () => {
    const client = clientSequence(caps("a.one"), caps("c.three"));
    const { result, rerender } = renderHook(({ uid }) => useEosCapabilityFeed({ uid }, { client }), { initialProps: { uid: "u1" } });
    await waitFor(() => expect(result.current.hasCapability("a.one")).toBe(true));
    rerender({ uid: "u2" });
    expect(result.current.hasCapability("a.one")).toBe(false);
    await waitFor(() => expect(result.current.hasCapability("c.three")).toBe(true));
  });
});

describe("F1 consumers: the EOS branch replaces Firebase, the Firebase branch is untouched", () => {
  afterEach(() => cleanup());

  it("useReportCapabilities (EOS source): the shell shape, answered by EOS, with the Firebase pair never touched", async () => {
    const client = clientSequence(caps("inventory.stock.receive", "customer.record.read"));
    const subscribeAccessVersion = vi.fn(() => () => {});
    const callFeed = vi.fn(async () => ({ data: {} }));
    const { result } = renderHook(() => useReportCapabilities({ uid: "u1" }, { eosSource: true, client, subscribeAccessVersion, callFeed }));
    expect(result.current.accessResolving).toBe(true);
    await waitFor(() => expect(result.current.accessResolving).toBe(false));
    expect(result.current.hasCapability("inventory.stock.receive")).toBe(true);
    expect(result.current.hasCapability("inventory.transfer.create")).toBe(false);
    expect(result.current.accessVersion).toBe(0);
    expect(typeof result.current.hasEosKey).toBe("function");
    expect(subscribeAccessVersion).not.toHaveBeenCalled();
    expect(callFeed).not.toHaveBeenCalled();
  });

  it("useReportCapabilities (EOS source) settles to a deny when EOS cannot answer -- the shell is never left on Loading", async () => {
    const { result } = renderHook(() => useReportCapabilities({ uid: "u1" }, { eosSource: true, client: clientSequence({ ok: false, code: "UNREACHABLE" }) }));
    await waitFor(() => expect(result.current.accessResolving).toBe(false));
    expect(result.current.hasCapability("customer.record.read")).toBe(false);
    expect(result.current.accessVersion).toBeNull();
  });

  it("useReportCapabilities (Firebase source): the EOS client is never called and the Firebase pair runs as before", async () => {
    const client = clientSequence(caps("customer.record.read"));
    const subscribeAccessVersion = vi.fn((uid, h) => { h.next(3); return () => {}; });
    const callFeed = vi.fn(async (ids) => ({ data: { accessVersion: 3, decisions: Object.fromEntries(ids.map((id) => [id, id === "customer.record.read"])) } }));
    const { result } = renderHook(() => useReportCapabilities({ uid: "u1" }, { eosSource: false, client, subscribeAccessVersion, callFeed }));
    await waitFor(() => expect(result.current.hasCapability("customer.record.read")).toBe(true));
    expect(result.current.accessVersion).toBe(3);
    expect(client.call).not.toHaveBeenCalled();
    expect(callFeed).toHaveBeenCalledTimes(1);
  });

  it("the Account page decisions (EOS source) follow the shell's EOS set through the session context; Firebase is untouched", async () => {
    const { SessionAccessContext } = await import("../src/access/sessionAccess.js");
    const subscribeAccessVersion = vi.fn(() => () => {});
    const callFeed = vi.fn(async () => ({ data: {} }));
    const access = { eosSource: true, settled: true, reload: () => {}, holds: (k) => ["crm.activity.read", "finance.invoice.read"].includes(k) };
    const wrapper = ({ children }) => <SessionAccessContext.Provider value={access}>{children}</SessionAccessContext.Provider>;
    const { result } = renderHook(() => useAccountPageCapabilityDecisions({ uid: "u1" }, { eosSource: true, subscribeAccessVersion, callFeed }), { wrapper });
    expect(result.current).toEqual({ "crm.activity.read": true, "finance.read": true, "opportunity.read": false, "salesOrder.read": false });
    expect(subscribeAccessVersion).not.toHaveBeenCalled();
    expect(callFeed).not.toHaveBeenCalled();
    // signed out: everything denied
    const out = renderHook(() => useAccountPageCapabilityDecisions(null, { eosSource: true }), { wrapper });
    expect(Object.values(out.result.current).every((v) => v === false)).toBe(true);
  });

  it("the Account page decisions (Firebase source) still ask the Firebase feed for exactly the page's four ids", async () => {
    const subscribeAccessVersion = vi.fn((uid, h) => { h.next(1); return () => {}; });
    const callFeed = vi.fn(async (ids) => ({ data: { accessVersion: 1, decisions: Object.fromEntries(ids.map((id) => [id, true])) } }));
    const { result } = renderHook(() => useAccountPageCapabilityDecisions({ uid: "u1" }, { eosSource: false, subscribeAccessVersion, callFeed }));
    await waitFor(() => expect(result.current["finance.read"]).toBe(true));
    expect([...callFeed.mock.calls[0][0]].sort()).toEqual(["crm.activity.read", "finance.read", "opportunity.read", "salesOrder.read"]);
  });

  it("useCurrentTechnician (EOS source): the link is the EOS Employee from AuthContext -- no Firestore read, no status pill", async () => {
    sessionStorage.setItem(EOS_SESSION_STORAGE_KEY, fakeToken());
    opsCall.mockResolvedValue({ ok: true, result: { tenantId: "t", principalId: "p", employeeId: "e-7", surfaces: [] } });
    function TechProbe() {
      const t = useCurrentTechnician({ eosSource: true });
      return <span data-testid="tech">{`${t.technicianId}|${t.technician?.id}|${t.technician?.name}|${String(t.technician?.status)}|${t.loading}`}</span>;
    }
    render(<AuthProvider><TechProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("tech").textContent).toBe("e-7|e-7|null|undefined|false"));
  });
});
