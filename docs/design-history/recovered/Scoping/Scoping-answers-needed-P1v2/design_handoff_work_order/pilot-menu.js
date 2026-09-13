// Floating pilot navigation — self-contained web component.
// Starts minimized (round ☰ pill), drag the pill to move it anywhere,
// click (without dragging) to open; the panel opens outward toward the
// screen center from wherever the pill sits. Position persists.
(function () {
  const LINKS = [
    ['★ Pilot report', 'EOS UX Pilot.dc.html'],
    ['§ Before / After'],
    ['1 · Account', '1 - Account Before-After.dc.html'],
    ['2 · Opportunity', '2 - Opportunity Before-After.dc.html'],
    ['3 · Sales Order', '3 - Sales Order Before-After.dc.html'],
    ['4 · Work Order', '4 - Work Order Before-After.dc.html'],
    ['5 · Parts', '5 - Parts Before-After.dc.html'],
    ['§ Current EOS'],
    ['Account detail', 'Current - Account Detail.dc.html'],
    ['Opportunities', 'Current - Opportunities.dc.html'],
    ['Sales order', 'Current - Sales Order.dc.html'],
    ['Work order', 'Current - Work Order.dc.html'],
    ['Parts list', 'Current - Parts List.dc.html'],
    ['Part detail', 'Current - Part Detail.dc.html'],
    ['§ Proposed'],
    ['Customer 360', 'Proposed - Account.dc.html'],
    ['Customer 360 · Broadsheet', 'Proposed - Account -Broadsheet-.dc.html'],
    ['Opportunity', 'Proposed - Opportunity.dc.html'],
    ['Sales order', 'Proposed - Sales Order.dc.html'],
    ['Work order', 'Proposed - Work Order.dc.html'],
    ['Parts workspace', 'Proposed - Parts.dc.html'],
    ['Dispatch board', 'Proposed - Dispatch Board.dc.html'],
    ['Dispatch map', 'Proposed - Dispatch Map.html'],
    ['Technician mobile', 'Proposed - Technician Mobile.dc.html'],
    ['Warehouse mobile', 'Proposed - Warehouse Mobile.dc.html'],
    ['§ Complete coverage'],
    ['Dashboard / My Day', 'Proposed - Dashboard.dc.html'],
    ['Service Operations', 'Proposed - Service Operations.dc.html'],
    ['Purchasing + suppliers', 'Proposed - Purchasing.dc.html'],
    ['Equipment', 'Proposed - Equipment.dc.html'],
    ['Customers list', 'Proposed - Customers List.dc.html'],
    ['Reporting', 'Proposed - Reporting.dc.html'],
    ['Administration', 'Proposed - Administration.dc.html'],
    ['Cycle counts', 'Proposed - Cycle Counts.dc.html'],
    ['Transfers + trucks', 'Proposed - Transfers Trucks.dc.html'],
    ['§ Subpage expansion'],
    ['★ Expansion report', 'North Star - Subpage Expansion.dc.html'],
    ['Agreement (edit/accepted)', 'Subpages - Commercial.dc.html'],
    ['Dense list + states', 'Subpages - Lists and States.dc.html'],
    ['Operations workflows', 'Subpages - Operations.dc.html'],
    ['§ North star'],
    ['Work order 10/10', 'North Star - Work Order.dc.html'],
  ];
  const KEY = 'eosPilotMenuPos';

  class PilotMenu extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host { position: fixed; z-index: 99999; left: 0; top: 0; font-family: Inter, system-ui, sans-serif; }
          .pill { width: 44px; height: 44px; border-radius: 50%; background: #102B24; color: #FCFAF6;
                  border: none; cursor: grab; font-size: 17px; line-height: 1; display: flex; align-items: center;
                  justify-content: center; box-shadow: 0 6px 18px rgba(16,43,36,0.3); touch-action: none; user-select: none; }
          .pill:active { cursor: grabbing; }
          .pill:hover { background: #1C4638; }
          .panel { position: absolute; background: #102B24; border-radius: 10px; padding: 8px 0;
                   box-shadow: 0 6px 18px rgba(16,43,36,0.4); max-height: 70vh; overflow: auto;
                   min-width: 190px; display: none; }
          .panel.open { display: block; }
          a { display: block; padding: 5px 14px; font-size: 12.5px; color: #FCFAF6; text-decoration: none; white-space: nowrap; }
          a:hover { background: #1C4638; }
          a.current { color: #B08A55; font-weight: 600; }
          .hdr { padding: 8px 14px 3px; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #B9C1BE; }
        </style>
        <button class="pill" aria-label="Pilot menu" aria-expanded="false">☰</button>
        <div class="panel" role="menu"></div>`;
      const pill = root.querySelector('.pill');
      const panel = root.querySelector('.panel');
      const here = decodeURIComponent(location.pathname.split('/').pop() || '');
      for (const [label, href] of LINKS) {
        if (!href) {
          const d = document.createElement('div');
          d.className = 'hdr';
          d.textContent = label.slice(2);
          panel.appendChild(d);
        } else {
          const a = document.createElement('a');
          a.href = href;
          a.textContent = label;
          if (here === href) a.classList.add('current');
          panel.appendChild(a);
        }
      }

      // position (persisted); default bottom-right
      let x, y;
      const place = () => {
        x = Math.min(Math.max(4, x), window.innerWidth - 48);
        y = Math.min(Math.max(4, y), window.innerHeight - 48);
        this.style.transform = `translate(${x}px, ${y}px)`;
        // open OUTWARD: toward the screen center from the pill
        const right = x > window.innerWidth / 2;
        const below = y > window.innerHeight / 2;
        panel.style.left = right ? 'auto' : '0';
        panel.style.right = right ? '0' : 'auto';
        panel.style.top = below ? 'auto' : '52px';
        panel.style.bottom = below ? '52px' : 'auto';
      };
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) { x = saved.x; y = saved.y; }
      } catch (e) { /* ignore */ }
      if (x == null) { x = window.innerWidth - 62; y = window.innerHeight - 62; }
      place();
      window.addEventListener('resize', place);

      // drag to move; a press that barely moves is a click (toggle)
      let drag = null;
      pill.addEventListener('pointerdown', (e) => {
        drag = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false };
        pill.setPointerCapture(e.pointerId);
      });
      pill.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
        if (drag.moved) { x = drag.ox + dx; y = drag.oy + dy; place(); }
      });
      pill.addEventListener('pointerup', (e) => {
        if (!drag) return;
        if (drag.moved) {
          try { localStorage.setItem(KEY, JSON.stringify({ x, y })); } catch (err) { /* ignore */ }
        } else {
          const open = panel.classList.toggle('open');
          pill.setAttribute('aria-expanded', String(open));
        }
        drag = null;
      });
      document.addEventListener('pointerdown', (e) => {
        if (!this.contains(e.target) && e.composedPath && !e.composedPath().includes(this)) {
          panel.classList.remove('open');
          pill.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }
  if (!customElements.get('pilot-menu')) customElements.define('pilot-menu', PilotMenu);
})();
