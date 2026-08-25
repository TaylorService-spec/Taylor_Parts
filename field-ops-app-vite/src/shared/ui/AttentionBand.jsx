// THE ATTENTION BLOCK (North Star pattern 3).
//
// From the pilot report: "'Needs attention / Blocking' listed first in the work area: ranked rows —
// severity word, plain-language fact, owner, deep link. Use only when items exist; renders nothing
// when clean. Don't use for informational status."
//
// ════════════════════ WHY IT RENDERS NOTHING WHEN CLEAN ════════════════════
//
// A band that says "no issues" every time trains people not to look at it. The absence of the band
// IS the clean signal. This is also why informational status may not live here: the moment it
// carries things that are merely true, it stops meaning "something needs you".
//
// ════════════════════ SEVERITY IS A WORD ════════════════════
//
// Grammar R04: severity is rendered as text and paired with a tone, never as colour alone — the
// ordering must survive grayscale and colour-blindness. The severity word comes from the domain
// layer; this component chooses no severities of its own.
//
// ════════════════════ EVERY BLOCKER, AT ONCE ════════════════════
//
// The band renders the whole list. Grammar R08: showing one reason, letting somebody fix it, and
// then revealing the next one wastes their day. If a future cap is ever needed it must state the
// remainder honestly ("+3 more"), never silently truncate.
const SEVERITY_WORD = { BLOCKING: "Blocking", ATTENTION: "Needs attention" };

export default function AttentionBand({ items = [], ariaLabel = "Needs attention" }) {
  if (!items || items.length === 0) return null;

  return (
    <section className="ns-attention" role="region" aria-label={ariaLabel}>
      <ul className="ns-attention__list">
        {items.map((item) => {
          const word = SEVERITY_WORD[item.severity] ?? "Needs attention";
          const tone = item.severity === "BLOCKING" ? "blocking" : "attention";
          return (
            <li className={`ns-attention__item is-${tone}`} key={item.key}>
              <span className="ns-attention__severity">{word}</span>
              <span className="ns-attention__fact">{item.fact}</span>
              {item.owner ? <span className="ns-attention__owner">{item.owner}</span> : null}
              {item.link ? <span className="ns-attention__link">{item.link}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
