import { APP_ENVIRONMENT } from "../firebase/firebase";
import VerenwardMark from "../shared/brand/VerenwardMark";

// AUTH SHELL -- identity, environment and support chrome shared by the sign-in
// and password-recovery views.
//
// WHY THIS EXISTS. Sign-in previously rendered a bare `.fo-panel` with an
// `<h2>Field Ops Login</h2>` and a `.fo-form` row. `.fo-form` is `display:flex`
// with `input { flex: 1 }` -- correct for the inline row filters and table-cell
// actions it was built for, wrong for a page-level auth form, which is why
// email, password and the submit button stretched across the whole viewport.
// This shell is the composition that surface always needed; `.fo-form` is
// untouched and keeps doing its job everywhere else.
//
// BRAND HIERARCHY (Owner-ruled, 2026-08-19). Three distinct tiers, and they are
// NOT interchangeable:
//   Verenward                -- parent / provisional brand
//   Enterprise Operations OS -- the platform
//   Taylor Parts             -- the implementation / workspace
// with "Taylor Freezer of Arizona" as company context where appropriate.
//
// An earlier draft of this screen rendered an invented "EOS" wordmark and mark.
// That was wrong on both counts: it promoted the platform to parent-brand
// position, and it drew a mark rather than using the one the repository already
// governs. Both are corrected here.
//
// The mark comes from `shared/brand/VerenwardMark`, which is explicitly a
// PROVISIONAL asset pending separate approval, and is isolated so replacement is
// a one-component change. The implementation is a clean TEXT treatment only --
// deliberately not a substitute corporate logo, and no Taylor logo is drawn,
// approximated or fetched.
//
// FINAL PARENT AND IMPLEMENTATION BRAND ASSETS REMAIN SUBJECT TO SEPARATE
// APPROVAL. Nothing here should be read as an approved identity.

// Approved copy. Held as constants so wording changes are one edit.
export const BRAND_HEADLINE = "RUN THE OPERATION.";
export const BRAND_SUPPORTING = "Service. Parts. Inventory. Sales. One connected system.";
export const WORKSPACE_NAME = "Taylor Parts";

function AlertIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.6v4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.95" fill="currentColor" />
    </svg>
  );
}

/**
 * Workspace badge -- the implementation, plus the environment when it is not
 * production.
 *
 * Production is deliberately UNMARKED: the environment half exists to stop
 * someone acting on the wrong data, so its presence always means "this is not
 * live". An unrecognised environment is shown rather than hidden, because
 * failing loud is the safer direction for that particular mistake.
 */
function WorkspaceBadge({ tone = "onLight" }) {
  const role = APP_ENVIRONMENT?.role ?? null;
  const environment =
    role === "production" ? null
    : role === "sandbox" ? "Sandbox"
    : role === "integration" ? "Integration"
    : "Non-production";

  return (
    <span className={`eos-auth__workspace eos-auth__workspace--${tone}`} title={APP_ENVIRONMENT?.id ?? "environment not identified"}>
      <span className="eos-auth__workspace-name">{WORKSPACE_NAME}</span>
      {environment ? (
        <>
          <span className="eos-auth__workspace-sep" aria-hidden="true">·</span>
          <span className="eos-auth__workspace-env">{environment}</span>
        </>
      ) : null}
    </span>
  );
}

// Build identity, from the same manifest the deployment publishes at
// /version.json. "Which build am I looking at" is a real support question, and
// this is the one screen every user reaches.
function BuildIdentity() {
  const commit = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : null;
  if (!commit) return null;
  return <span className="eos-auth__build">Build {commit}</span>;
}

/**
 * Two-panel on desktop, single column on narrow screens.
 * `title` names the task; children are the form for it.
 */
export default function AuthShell({ title, intro, children, footerNote }) {
  return (
    <main className="eos-auth">
      <div className="eos-auth__layout">
        <section className="eos-auth__brand">
          <VerenwardMark variant="horizontal" tone="onDark" size={38} />

          <div className="eos-auth__pitch">
            <p className="eos-auth__headline">{BRAND_HEADLINE}</p>
            <p className="eos-auth__supporting">{BRAND_SUPPORTING}</p>
          </div>

          <div className="eos-auth__brand-foot">
            <WorkspaceBadge tone="onDark" />
          </div>
        </section>

        <section className="eos-auth__card">
          {/* Identity repeats inside the card for narrow screens, where the brand
              panel is hidden entirely rather than stacked into a banner nobody
              reads. */}
          <div className="eos-auth__identity--compact">
            <VerenwardMark variant="horizontal" tone="onLight" size={30} />
          </div>

          <h1 className="eos-auth__title">{title}</h1>
          {intro ? <p className="eos-auth__intro">{intro}</p> : null}

          {children}

          <div className="eos-auth__footer">
            <p className="eos-auth__support">{footerNote ?? "Need access? Ask your administrator."}</p>
            <span className="eos-auth__meta">
              <span className="eos-auth__workspace-compact">
                <WorkspaceBadge tone="onLight" />
              </span>
              <BuildIdentity />
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}

/** Error presentation with the alert semantics a failed sign-in needs. */
export function AuthError({ children }) {
  if (!children) return null;
  return (
    <p className="eos-auth__error" role="alert">
      <AlertIcon />
      <span>{children}</span>
    </p>
  );
}
