// THE (i) DISCLOSURE — the interaction the Owner ruled, made falsifiable.
//
// Owner ruling B, 2026-08-31, approved moving governance detail behind a control on the explicit
// condition that it stay REACHABLE. A disclosure that quietly failed to open — or opened only for a
// mouse — would not be progressive disclosure, it would be a deletion with an icon in front of it.
// Every clause of that ruling is asserted here.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import PartsInfoDisclosure from "../src/modules/inventory/PartsInfoDisclosure.jsx";

const SECRET = "The balance read is built and governed, and is not switched on here.";

function renderOne(label = "On order — why this is not available") {
  return render(
    <p>
      Not available in this environment
      <PartsInfoDisclosure label={label}>{SECRET}</PartsInfoDisclosure>
    </p>
  );
}

// OPEN IS THE ABSENCE OF `hidden`, asserted directly rather than through a jest-dom matcher this
// project does not register. It is also the more precise claim: `hidden` is the exact mechanism the
// ruling depends on, because it removes the panel from layout AND from the accessibility tree.
const isOpen = () => !document.querySelector(".ns-info__panel").hasAttribute("hidden");

afterEach(cleanup);

describe("it is a real control, not a decorative span", () => {
  it("is a button, and its name says WHAT it explains", () => {
    renderOne();
    const btn = screen.getByRole("button", { name: /Explain: On order/i });
    expect(btn.tagName).toBe("BUTTON");
    // "More information" would tell a screen-reader user there are three identical controls on this
    // page and nothing about which one they want.
    expect(btn.getAttribute("aria-label")).toMatch(/on order/i);
  });

  it("declares its state and the panel it controls", () => {
    renderOne();
    const btn = screen.getByRole("button", { name: /Explain/i });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    const id = btn.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    // aria-controls must point at an element that EXISTS, or the relationship it declares is a lie.
    // That is why the panel is rendered hidden rather than conditionally mounted.
    expect(document.getElementById(id)).not.toBeNull();
  });

  it("is openable from the KEYBOARD because it is a native button", () => {
    // ASSERTED AS A FACT ABOUT THE ELEMENT, not by synthesising a keypress. Enter and Space activate
    // a <button type="button"> because the PLATFORM does it, and jsdom does not implement that
    // mapping — so a keydown test here would prove something about the harness rather than about
    // the control. Being a real, enabled, focusable button IS the mechanism, and it is exactly what
    // a <span onClick> would fail. Pointer and keyboard activation share the one onClick.
    renderOne();
    const btn = screen.getByRole("button", { name: /Explain/i });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
  });
});

describe("the explanation is genuinely reachable", () => {
  it("opens on click and the words are in the document", () => {
    renderOne();
    expect(isOpen()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Explain/i }));
    expect(isOpen()).toBe(true);
    expect(screen.getByText(SECRET).textContent).toContain(SECRET);
    expect(screen.getByRole("button", { name: /Hide:/i }).getAttribute("aria-expanded")).toBe("true");
  });

  it("is exposed to assistive technology as a note, not as bare text", () => {
    renderOne();
    fireEvent.click(screen.getByRole("button", { name: /Explain/i }));
    expect(screen.getByRole("note").textContent).toContain(SECRET);
  });
});

describe("it can be dismissed, by every route the ruling names", () => {
  it("Escape closes it and returns focus to the trigger", () => {
    renderOne();
    fireEvent.click(screen.getByRole("button", { name: /Explain/i }));
    expect(isOpen()).toBe(true);
    expect(screen.getByText(SECRET).textContent).toContain(SECRET);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(isOpen()).toBe(false);
    // Focus must not be stranded on a control that no longer exists to the reader.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Explain/i }));
  });

  it("a click outside closes it", () => {
    renderOne();
    fireEvent.click(screen.getByRole("button", { name: /Explain/i }));
    expect(isOpen()).toBe(true);
    expect(screen.getByText(SECRET).textContent).toContain(SECRET);
    fireEvent.mouseDown(document.body);
    expect(isOpen()).toBe(false);
  });

  it("its own Close button closes it", () => {
    renderOne();
    fireEvent.click(screen.getByRole("button", { name: /Explain/i }));
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(isOpen()).toBe(false);
  });

  it("the trigger toggles rather than only opening", () => {
    renderOne();
    fireEvent.click(screen.getByRole("button", { name: /Explain/i }));
    fireEvent.click(screen.getByRole("button", { name: /Hide:/i }));
    expect(isOpen()).toBe(false);
  });
});

describe("a closed disclosure costs the page nothing", () => {
  it("the panel is hidden, so it contributes no permanent vertical height", () => {
    renderOne();
    const btn = screen.getByRole("button", { name: /Explain/i });
    const panel = document.getElementById(btn.getAttribute("aria-controls"));
    // `hidden` is the whole mechanism: it removes the element from layout AND from the accessibility
    // tree, which is what makes "behind the (i)" cost zero height rather than trading one kind of
    // permanent height for another.
    expect(panel.hasAttribute("hidden")).toBe(true);
  });
});

describe("it is valid inside a paragraph, which two of the three call sites are", () => {
  it("renders no block-level element that a <p> would reparse", () => {
    const { container } = renderOne();
    const p = container.querySelector("p");
    // A <div> inside a <p> is closed by the parser, which moves everything after it out of the
    // paragraph — a layout that works everywhere except in a browser.
    expect(p.querySelector("div")).toBeNull();
    expect(p.querySelector("p")).toBeNull();
  });
});
