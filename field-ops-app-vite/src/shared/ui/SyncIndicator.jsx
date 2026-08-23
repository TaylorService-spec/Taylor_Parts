import { Button } from "./primitives/index.js";

// THE ONE LINE THAT SAYS WHETHER ANYTHING IS OUTSTANDING.
//
// Deliberately tiny and deliberately EAGER — it is not lazy-loaded, because the whole point is that a
// technician can never be in a state where unsynced work exists and nothing on screen says so. A
// chunk that has not downloaded yet cannot tell them that.
//
// ============================ NOT A SPINNER ============================
//
// It states a COUNT and a CONSEQUENCE. "3 items waiting to sync" is actionable; a rotating icon is
// decoration. And work that needs a person is called out separately from work that is merely
// waiting — a technician who reads "3 waiting" and walks away, when one of the three was refused an
// hour ago, has been misled by a number that was technically true.
//
// ============================ STATUS IS NEVER COLOUR ALONE ============================
//
// The severity drives a class, and the WORD carries the meaning regardless. Sunlight, colour
// blindness and a greyscale support screenshot all have to work.

export default function SyncIndicator({ indicator, syncing, onOpen, onSync }) {
  if (!indicator) return null;
  const { severity, headline, detail, count } = indicator;
  const quiet = severity === "ok" && count === 0;

  return (
    <section
      className={`fo-sync-indicator fo-sync-indicator--${severity}`}
      aria-label="Sync status"
    >
      <div className="fo-sync-indicator__text">
        {/* role=status so a change is announced without stealing focus from whatever the technician
            is doing. An interruption in the middle of entering time is worse than a late reading. */}
        <p className="fo-sync-indicator__headline" role="status">
          {syncing ? "Syncing…" : headline}
        </p>
        {detail ? <p className="fo-sync-indicator__detail">{detail}</p> : null}
      </div>

      {!quiet ? (
        <div className="fo-sync-indicator__actions">
          {/* NO HIDDEN QUEUE. If anything is outstanding there is always a way to see exactly what. */}
          <Button variant="secondary" className="fo-sync-indicator__button" onClick={onOpen}>
            View
          </Button>
          {onSync ? (
            <Button
              variant="secondary"
              className="fo-sync-indicator__button"
              onClick={onSync}
              disabled={syncing}
            >
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
