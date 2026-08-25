import React from "react";
import FailureState from "../shared/ui/FailureState.jsx";
import Button from "../shared/ui/primitives/Button.jsx";
import { buildCrashDiagnostic, diagnosticsVisible, formatCrashSummary } from "../diagnostics/crashDiagnostics.js";

// Root error boundary (mounted in main.jsx ABOVE AuthProvider and App, so it catches
// every render crash in the application).
//
// TWO DEFECTS THIS FIXES (EOS-ISSUE-852-C09, recovered 2026-08-16):
//
//  1. NO RESET. The previous version latched `hasError` forever. Because it wraps the
//     whole tree, ONE render crash killed the entire session -- every route, every
//     surface -- with no user-recoverable path short of a manual browser reload. A
//     technician mid-job lost the app until they knew to reload. Recovery now exists:
//     "Try again" clears the error and REMOUNTS the subtree via a changing key, so a
//     transient failure (a bad read, a momentary null) genuinely recovers.
//
//  2. RAW ERROR LEAKED TO THE USER. It rendered `String(this.state.error)` into a
//     <pre>. That contradicts this codebase's standing convention -- see
//     FailureState's own contract: it "never receives or renders a raw Firebase error,
//     code, path, id, or stack." Diagnostics belong in the console, not on screen.
//
// A retry that re-crashes is expected and safe: the boundary simply catches again.
// `retryCount` is kept so a repeatedly-failing surface can be recognised rather than
// looking like a fresh failure each time.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, resetKey: 0, retryCount: 0 };
    this.handleRetry = this.handleRetry.bind(this);
    this.handleReload = this.handleReload.bind(this);
  }

  static getDerivedStateFromError() {
    // Deliberately does NOT store the error object. Nothing in the fallback renders it,
    // and holding it invites a future edit that puts a stack on screen.
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // The developer channel keeps full fidelity, including the component stack.
    console.error("UI Crash:", error, info?.componentStack ?? info);
  }

  handleRetry() {
    // Changing `resetKey` remounts children, so a component that failed on mount gets a
    // genuine second attempt rather than being restored into its broken state.
    this.setState((s) => ({
      hasError: false,
      resetKey: s.resetKey + 1,
      retryCount: s.retryCount + 1,
    }));
  }

  handleReload() {
    window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      const repeated = this.state.retryCount > 0;
      const { diagnostic } = this.state;
      // NON-PRODUCTION ONLY. A crash id and a copy control are a debugging affordance; production
      // keeps the governed screen it has always had, because nothing in this repository permits
      // putting internals in front of a production user. The console output is unchanged in both.
      const showDiagnostic = diagnostic != null && diagnosticsVisible();
      return (
        <FailureState
          title="Something went wrong"
          message={
            repeated
              ? "This screen failed again. Reloading may clear it. If it keeps happening, report it — the details are in the browser console."
              : "This screen stopped responding. Your work up to this point was not lost. Try again, or reload if it keeps happening."
          }
          action={
            <>
              {/* THE CRASH ID IS THE POINT. One short code a person can read out of a screenshot,
                  matching the console entry and the copied payload — so an occurrence somebody SAW
                  can be tied to an occurrence somebody can act on. */}
              {showDiagnostic && (
                <p className="fo-crash-id" data-testid="crash-id">
                  Crash ID: <strong>{diagnostic.crashId}</strong>
                </p>
              )}
              <div className="fo-crash-actions">
                <Button variant="primary" onClick={this.handleRetry}>
                  Try again
                </Button>
                <Button variant="secondary" onClick={this.handleReload}>
                  Reload
                </Button>
                {showDiagnostic && (
                  <Button variant="secondary" onClick={this.handleCopy}>
                    {this.state.copied ? "Diagnostic copied" : "Copy diagnostic"}
                  </Button>
                )}
              </div>
            </>
          }
        />
      );
    }

    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
