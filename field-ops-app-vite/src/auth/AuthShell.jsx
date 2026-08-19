import { APP_ENVIRONMENT } from "../firebase/firebase";

// EOS AUTH SHELL -- the identity, environment and support chrome shared by the
// sign-in and password-recovery views.
//
// WHY THIS EXISTS. The sign-in screen previously rendered a bare `.fo-panel`
// with an `<h2>Field Ops Login</h2>` and a `.fo-form` row. `.fo-form` is
// `display:flex` with `input { flex: 1 }` -- correct for the inline row filters
// and table-cell actions it was built for, wrong for a page-level auth form,
// which is why email, password and the submit button stretched across the whole
// viewport. This shell is the composition that surface always needed; `.fo-form`
// is untouched and keeps doing its job everywhere else.
//
// The visual language is entirely the existing Verenward token set. Nothing new
// was invented: the front door was simply the one surface not speaking it.

// PRODUCT IDENTITY -- deliberately ONE constant each.
//
// "Field Ops" is the legacy sub-product name and undersells the platform. The
// repository's own vocabulary for the whole system is "Enterprise Operations
// OS" (see docs/), which is what these default to.
//
// A company-specific wordmark (e.g. "Taylor Operations") was considered and NOT
// adopted unilaterally: this platform serves TWO operating companies under
// common ownership -- Taylor and Ventana -- and `operatingCompanyId` is a real
// distinction in the data model. A single-company wordmark on the shared front
// door would tell every Ventana user they are in the wrong system. Naming the
// product after one of its tenants is an Owner decision, not a design one, so
// it lives here as a single edit rather than being scattered through JSX.
export const PRODUCT_NAME = "EOS";
export const PRODUCT_DESCRIPTOR = "Enterprise Operations OS";
export const PRODUCT_PROMISE =
  "One place to run service, parts, inventory, customers and field operations.";

// Drawn mark, not an emoji or unicode glyph: three operational lanes converging
// on a single point of control. Inherits `color` so it tracks the wordmark.
function EosMark({ size = 30 }) {
  return (
    <svg
      className="eos-auth__mark"
      width={size}
      height={size}
      viewBox="0 0 30 30"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0.75" y="0.75" width="28.5" height="28.5" rx="7.25" stroke="currentColor" strokeWidth="1.5" opacity="0.28" />
      <path d="M8 10.5h9.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M8 15h13" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M8 19.5h6.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="21.5" cy="19.5" r="2.75" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.6v4.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.95" fill="currentColor" />
    </svg>
  );
}

// The badge exists to stop someone acting on the wrong data, so production is
// the UNMARKED default: whenever it is present it means "this is not live". An
// unknown environment is shown rather than hidden -- failing loud is the safer
// direction for this particular mistake.
function EnvironmentBadge() {
  const role = APP_ENVIRONMENT?.role ?? null;
  if (role === "production") return null;
  const label = role === "sandbox" ? "Sandbox" : role === "integration" ? "Integration" : "Non-production";
  return (
    <span className="eos-auth__env" title={APP_ENVIRONMENT?.id ?? "environment not identified"}>
      <span className="eos-auth__env-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

// Build identity, read from the same manifest the deployment already publishes
// at /version.json. Shown because "which build am I looking at" is a real
// support question, and this is the one screen every user reaches.
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
        <section className="eos-auth__brand" aria-hidden="true">
          <div className="eos-auth__brand-identity">
            <EosMark size={38} />
            <div>
              <p className="eos-auth__wordmark eos-auth__wordmark--brand">{PRODUCT_NAME}</p>
              <p className="eos-auth__descriptor">{PRODUCT_DESCRIPTOR}</p>
            </div>
          </div>
          <p className="eos-auth__promise">{PRODUCT_PROMISE}</p>
          <div className="eos-auth__brand-foot">
            <EnvironmentBadge />
          </div>
        </section>

        <section className="eos-auth__card">
          {/* The identity repeats inside the card for narrow screens, where the
              brand panel is hidden entirely rather than stacked into a banner
              nobody reads. */}
          <div className="eos-auth__identity eos-auth__identity--compact">
            <EosMark />
            <div>
              <p className="eos-auth__wordmark">{PRODUCT_NAME}</p>
              <p className="eos-auth__descriptor">{PRODUCT_DESCRIPTOR}</p>
            </div>
          </div>

          <h1 className="eos-auth__title">{title}</h1>
          {intro ? <p className="eos-auth__intro">{intro}</p> : null}

          {children}

          <div className="eos-auth__footer">
            <p className="eos-auth__support">{footerNote ?? "Need access? Ask your administrator."}</p>
            <span className="eos-auth__meta">
              <span className="eos-auth__env-compact">
                <EnvironmentBadge />
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
