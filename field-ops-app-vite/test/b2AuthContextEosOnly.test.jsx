// FIREBASE EXIT B2 -- AuthContext and the bearer in an EOS-ONLY sign-in build, proved in jsdom.
//
// The build seam (auth/authSource.js) is mocked TRUE and every Firebase entry point is a spy that fails the test if it is
// reached. What is proved: no Firebase auth subscription, no Firebase sign-in, sign-out or reset email; the context settles
// signed out (not "Loading" forever) when there is no EOS session; and the one bearer function returns null rather than ask
// Firebase for a token, even when a Firebase user object is lying around.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

const firebase = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  signOut: vi.fn(async () => {}),
  signInWithEmailAndPassword: vi.fn(async () => ({})),
  sendPasswordResetEmail: vi.fn(async () => {}),
  auth: { currentUser: { getIdToken: vi.fn(async () => "firebase-id-token") } },
}));
vi.mock("../src/auth/authSource.js", () => ({ EOS_AUTH_ONLY: true, resolveEosAuthOnly: () => true }));
vi.mock("../src/firebase/firebase", () => ({ auth: firebase.auth, db: null, functions: null }));
vi.mock("../src/firebase/firebase.js", () => ({ auth: firebase.auth, db: null, functions: null }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (...a) => firebase.onAuthStateChanged(...a),
  signOut: (...a) => firebase.signOut(...a),
  signInWithEmailAndPassword: (...a) => firebase.signInWithEmailAndPassword(...a),
  sendPasswordResetEmail: (...a) => firebase.sendPasswordResetEmail(...a),
}));
vi.mock("../src/services/operationsApiClient.js", () => ({ operationsApiClient: { call: vi.fn() } }));
vi.mock("../src/auth/employeeSession", () => ({ resolveEmployeeSession: vi.fn(), buildEmployeeSessionResult: vi.fn() }));

import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { currentIdToken } from "../src/services/adminPolicyApiClient.js";

let api;
function Probe() {
  api = useAuth();
  return (
    <div>
      <span data-testid="signed-in">{api.user ? "yes" : "no"}</span>
      <span data-testid="loading">{api.loading ? "loading" : "ready"}</span>
      <span data-testid="error">{api.identityError ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  for (const fn of [firebase.onAuthStateChanged, firebase.signOut, firebase.signInWithEmailAndPassword, firebase.sendPasswordResetEmail, firebase.auth.currentUser.getIdToken]) fn.mockClear();
});

describe("an EOS-only sign-in build", () => {
  it("settles SIGNED OUT with no EOS session, and never subscribes to Firebase auth", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("ready"));
    expect(screen.getByTestId("signed-in").textContent).toBe("no");
    expect(screen.getByTestId("error").textContent).toBe("");
    expect(firebase.onAuthStateChanged).not.toHaveBeenCalled();
  });

  it("login, password reset and logout never reach Firebase", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("ready"));
    await expect(api.login("a@sandbox.invalid", "pw")).rejects.toMatchObject({ code: "EOS_AUTH_ONLY" });
    await expect(api.resetPassword("a@sandbox.invalid")).rejects.toMatchObject({ code: "EOS_AUTH_ONLY" });
    await act(async () => { await api.logout(); });
    expect(firebase.signInWithEmailAndPassword).not.toHaveBeenCalled();
    expect(firebase.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(firebase.signOut).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("ready"));
  });

  it("the bearer has no Firebase fallback: null, and the Firebase user is never asked for a token", async () => {
    expect(await currentIdToken()).toBeNull();
    expect(firebase.auth.currentUser.getIdToken).not.toHaveBeenCalled();
  });
});
