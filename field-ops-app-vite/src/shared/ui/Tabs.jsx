// SHARED TABS (UI corrections package, 2026-10-08, item D / H).
//
// WAI-ARIA tabs: a tablist of buttons, Left/Right/Home/End move between tabs (automatic activation), each panel is
// labelled by its tab. The active tab can live in the URL (`?tab=`) so a refresh, a link and Back return to the same tab.
// Only the ACTIVE panel is mounted: a panel's reads run when the person opens it, and remount (re-read) on return.
import { useCallback, useId, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/** The active tab id kept in `?<param>=`; an unknown value falls back to the first tab. */
export function useUrlTab(tabs, param = "tab") {
  const [params, setParams] = useSearchParams();
  const requested = params.get(param);
  const active = tabs.some((t) => t.id === requested) ? requested : tabs[0]?.id;
  const select = useCallback((id) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id === tabs[0]?.id) next.delete(param); else next.set(param, id);
      return next;
    }, { replace: true });
  }, [param, setParams, tabs]);
  return [active, select];
}

export default function Tabs({ tabs, active, onSelect, label, className = "" }) {
  const base = useId();
  const refs = useRef({});
  const index = Math.max(0, tabs.findIndex((t) => t.id === active));
  const move = (to) => {
    const t = tabs[(to + tabs.length) % tabs.length];
    onSelect(t.id);
    refs.current[t.id]?.focus();
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); move(index + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(index - 1); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(tabs.length - 1); }
  };
  const current = tabs[index];
  return (
    <div className={`fo-tabs ${className}`.trim()}>
      <div role="tablist" aria-label={label} className="fo-tabs__list" onKeyDown={onKeyDown}>
        {tabs.map((t) => {
          const selected = t.id === current?.id;
          return (
            <button key={t.id} type="button" role="tab" id={`${base}-tab-${t.id}`} aria-controls={`${base}-panel-${t.id}`}
              aria-selected={selected} tabIndex={selected ? 0 : -1} data-tab={t.id}
              className={`fo-tabs__tab${selected ? " fo-tabs__tab--active" : ""}`}
              ref={(el) => { refs.current[t.id] = el; }} onClick={() => onSelect(t.id)}>
              {t.label}
              {t.badge !== undefined && t.badge !== null ? <span className="fo-tabs__badge">{t.badge}</span> : null}
            </button>
          );
        })}
      </div>
      {current ? (
        <div role="tabpanel" id={`${base}-panel-${current.id}`} aria-labelledby={`${base}-tab-${current.id}`}
          className="fo-tabs__panel" data-tab-panel={current.id} tabIndex={0}>
          {current.render()}
        </div>
      ) : null}
    </div>
  );
}
