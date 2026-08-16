// @vitest-environment jsdom
//
// EOS-ISSUE-852-C09 finding 1 (HIGH) -- RENDER tests (vitest + jsdom).
//
// ErrorBoundary is mounted in main.jsx ABOVE AuthProvider and App, so it wraps the
// ENTIRE application. The previous implementation latched `hasError` permanently and
// exposed no reset, which meant a single render crash anywhere killed the whole session
// until the user independently decided to reload the browser. It also rendered
// `String(error)` into a <pre>, contradicting the codebase convention that user-facing
// failures never carry a raw error, code, path, id, or stack (see FailureState's own
// contract).
//
// These tests pin both halves: recovery must exist, and diagnostics must not reach the
// screen. React logs caught errors to console.error by design, so console.error is
// silenced per-test to keep output readable -- the assertions, not the noise, are the
// contract.
import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ErrorBoundary from "../src/components/ErrorBoundary.jsx";

function Boom({ shouldThrow, label = "recovered" }) {
  if (shouldThrow) throw new Error("SECRET_INTERNAL_DETAIL /db/path/abc123");
  return <p>{label}</p>;
}

// React 19 also re-reports a boundary-CAUGHT error to the global error handler. jsdom
// surfaces that as an unhandled error and vitest fails the file on it, even though the
// boundary handled it correctly -- so swallow it here. This suppresses reporting only;
// it does not stop the boundary from catching, which is what the assertions verify.
const swallow = (e) => e.preventDefault();

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.addEventListener("error", swallow);
});
afterEach(() => {
  window.removeEventListener("error", swallow);
  vi.restoreAllMocks();
  cleanup();
});

describe("ErrorBoundary", () => {
  test("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} label="all good" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeTruthy();
  });

  test("catches a render crash and shows an actionable failure state", () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  test("NEVER renders the raw error text on screen", () => {
    const { container } = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(container.textContent).not.toContain("SECRET_INTERNAL_DETAIL");
    expect(container.textContent).not.toContain("/db/path/abc123");
    expect(container.querySelector("pre")).toBeNull();
  });

  test("still logs full detail to the developer channel", () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    const logged = console.error.mock.calls.some((args) => args[0] === "UI Crash:");
    expect(logged).toBe(true);
  });

  test("DEFECT GUARD: 'Try again' recovers -- the crash is not permanent", () => {
    // The throw is controlled from OUTSIDE the component on purpose. React retries a
    // throwing render once internally before falling back to the boundary, so a
    // component that "heals itself on second invocation" heals during React's own
    // retry and never reaches the boundary at all -- which is not the behaviour under
    // test. Flipping the flag between assertions models the real case: a transient
    // failure that is gone by the time the user clicks Try again.
    const ctl = { throws: true };
    function Controlled() {
      if (ctl.throws) throw new Error("transient");
      return <p>recovered</p>;
    }

    render(
      <ErrorBoundary>
        <Controlled />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();

    ctl.throws = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("recovered")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a retry that crashes again is caught, and the copy escalates", () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/failed again/i)).toBeTruthy();
  });

  test("Reload triggers a browser reload", () => {
    const reload = vi.fn();
    const original = window.location;
    delete window.location;
    window.location = { ...original, reload };

    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();

    window.location = original;
  });
});
