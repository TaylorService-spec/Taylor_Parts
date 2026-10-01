import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../shared/ui/primitives";
import { customerMessageFor, groupSlotsByDay, selfSchedulingClient } from "../../services/selfSchedulingApiClient.js";

// CUSTOMER SELF-SCHEDULING -- the customer's page (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30).
//
// DELIBERATELY SIMPLE: what the visit is (enough to recognize it), the available dates and times, one choice, the
// confirmation -- and a plain sentence when the link has expired, was withdrawn, or a time was just taken. No login, no
// EOS navigation, no internal vocabulary, no identifiers. Displayed times are NOT reserved: EOS revalidates the choice
// when it is made, and a stale choice comes back with fresh times.

const VISIT_LABELS = { SERVICE_CALL: "Service visit", PM: "Planned maintenance", INSTALL: "Installation", WARRANTY: "Warranty service", INSPECTION: "Inspection" };

export default function CustomerSchedulingPage({ token, client = selfSchedulingClient }) {
  const [state, setState] = useState({ status: "loading" });
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const res = await client.readOffer(token);
    if (res.ok) setState({ status: res.result.status === "CONFIRMED" ? "confirmed" : "open", offer: res.result });
    else setState({ status: "refused", message: customerMessageFor(res.code) });
  }, [client, token]);
  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => groupSlotsByDay(state.offer?.slots), [state.offer]);

  const confirm = async () => {
    if (!chosen) return;
    setBusy(true);
    setNotice(null);
    const res = await client.select(token, chosen.slotStart);
    setBusy(false);
    if (res.ok) {
      setState({ status: "confirmed", offer: res.result });
      return;
    }
    setNotice(customerMessageFor(res.code));
    setChosen(null);
    if (res.code === "SLOT_NO_LONGER_AVAILABLE" && res.refreshed?.slots) {
      setState((s) => ({ ...s, offer: { ...s.offer, slots: res.refreshed.slots } }));
    } else if (res.code === "SESSION_ALREADY_USED") {
      await load();
    } else {
      setState({ status: "refused", message: customerMessageFor(res.code) });
    }
  };

  return (
    <main className="fo-panel fo-self-schedule" aria-labelledby="fo-self-schedule-title">
      <h1 id="fo-self-schedule-title">Schedule your service visit</h1>
      {state.status === "loading" && <p role="status">Loading available times…</p>}
      {state.status === "refused" && <p role="alert">{state.message}</p>}
      {state.status === "confirmed" && (
        <section aria-label="Confirmation">
          <p role="status"><strong>You're booked.</strong></p>
          <p>{state.offer.dateLabel} at {state.offer.timeLabel}</p>
          <p className="fo-muted">We'll see you then. If you need to change this visit, please contact us.</p>
        </section>
      )}
      {state.status === "open" && (
        <>
          <section aria-label="Your visit">
            <p><strong>{VISIT_LABELS[state.offer.job.visitType] ?? "Service visit"}</strong>{state.offer.job.customerName ? ` for ${state.offer.job.customerName}` : ""}</p>
            {(state.offer.job.siteName || state.offer.job.siteAddress) && (
              <p>{[state.offer.job.siteName, state.offer.job.siteAddress].filter(Boolean).join(" — ")}</p>
            )}
            {state.offer.job.problemSummary && <p className="fo-muted">{state.offer.job.problemSummary}</p>}
            <p className="fo-muted">About {state.offer.job.visitMinutes} minutes. Times are shown in {state.offer.timeZone}.</p>
          </section>
          {notice && <p role="alert">{notice}</p>}
          {days.length === 0 ? (
            <p role="status">There are no open times right now. Please contact us to schedule.</p>
          ) : (
            <section aria-label="Available times">
              {days.map((day) => (
                <fieldset key={day.dateLabel} className="fo-self-schedule__day">
                  <legend>{day.dateLabel}</legend>
                  {day.slots.map((slot) => (
                    <label key={slot.slotStart} className="fo-self-schedule__slot">
                      <input type="radio" name="slot" value={slot.slotStart}
                        checked={chosen?.slotStart === slot.slotStart} onChange={() => setChosen(slot)} />
                      {slot.timeLabel}
                    </label>
                  ))}
                </fieldset>
              ))}
              <Button variant="primary" disabled={!chosen || busy} onClick={confirm}>
                {busy ? "Booking…" : chosen ? `Book ${chosen.dateLabel} at ${chosen.timeLabel}` : "Choose a time"}
              </Button>
            </section>
          )}
        </>
      )}
    </main>
  );
}
