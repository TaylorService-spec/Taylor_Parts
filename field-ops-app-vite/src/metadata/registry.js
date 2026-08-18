// EOS Metadata — component and action registries.
//
// GOVERNANCE: docs/governance/metadata-architecture-ip-boundary.md §6 and §8,
// docs/specifications/metadata-architecture.md §7-§8.
//
// This is the layer where a metadata id becomes something that actually runs, which
// makes it where both boundary rules are either enforced or quietly lost.
//
// §8 — NO EXECUTABLE METADATA. Definitions reference components and actions by
// STABLE ID. The registry is the only place an id becomes a function, and it is
// populated by application code at startup — never by a definition, never by
// authored JSON, and never by a future tenant override store. That asymmetry is the
// whole point: configuration selects from a fixed menu of registered behavior, so
// widening what a tenant may configure can never widen what code may run.
//
// §6 — METADATA NEVER GRANTS AUTHORITY. An ActionDefinition names the governed
// command it dispatches and the capability that command requires. It does not carry
// the command, cannot invoke one that was not registered, and its
// `capabilityRequirement` is a DECLARATION handed to the real resolver — never a
// decision. `resolveAction()` returns the registered entry; it never returns
// "allowed".
//
// The failure this prevents is specific and cheap to fall into: a registry that
// accepts an arbitrary function turns a page definition into a script, and a tenant
// configuration layer built on top of that is remote code execution with extra
// steps.

/** What a registered component is for. Keeps a record section from being used as a row cell. */
export const COMPONENT_KIND = Object.freeze([
  "RECORD_SECTION", // a region on a record page
  "CELL_RENDERER", // one column's cell in a list
  "HIGHLIGHT", // a single metric in a record header
  "LIST_SURFACE", // a whole list surface
]);

/**
 * How an action reaches the backend.
 *
 * GOVERNED_COMMAND is the only kind that writes. NAVIGATION and DISCLOSURE exist so
 * that "open the record" and "expand this section" do not have to masquerade as
 * commands to be expressible — if they did, every harmless affordance would carry a
 * command path and the dangerous ones would stop standing out.
 */
export const ACTION_KIND = Object.freeze(["GOVERNED_COMMAND", "NAVIGATION", "DISCLOSURE"]);

class Registry {
  #entries = new Map();
  #label;

  constructor(label) {
    this.#label = label;
  }

  register(entry) {
    const problems = this.validate(entry);
    if (problems.length) {
      throw new Error(`${this.#label}: refusing to register "${entry?.id}" — ${problems.join("; ")}`);
    }
    if (this.#entries.has(entry.id)) {
      // Silent overwrite would let a late import shadow a governed action with a
      // different one under the same id, which is exactly how an authorization gap
      // gets introduced without any diff looking wrong.
      throw new Error(`${this.#label}: "${entry.id}" is already registered — ids are stable and unique`);
    }
    this.#entries.set(entry.id, Object.freeze({ ...entry }));
    return entry.id;
  }

  /** Resolve an id. Returns null for unknown — never throws, never guesses a fallback. */
  resolve(id) {
    return this.#entries.get(id) ?? null;
  }

  has(id) {
    return this.#entries.has(id);
  }

  ids() {
    return [...this.#entries.keys()].sort();
  }

  /** Test-only: registries are module singletons and would otherwise leak between cases. */
  __resetForTest() {
    this.#entries.clear();
  }

  // eslint-disable-next-line class-methods-use-this
  validate() {
    return [];
  }
}

class ComponentRegistry extends Registry {
  constructor() {
    super("ComponentRegistry");
  }

  validate(entry) {
    const problems = [];
    if (!entry?.id || typeof entry.id !== "string") problems.push("id is required");
    if (!COMPONENT_KIND.includes(entry?.kind)) problems.push(`kind "${entry?.kind}" is not a known COMPONENT_KIND`);
    if (typeof entry?.component !== "function") problems.push("component must be a function (a React component)");
    return problems;
  }
}

class ActionRegistry extends Registry {
  constructor() {
    super("ActionRegistry");
  }

  validate(entry) {
    const problems = [];
    if (!entry?.id || typeof entry.id !== "string") problems.push("id is required");
    if (!entry?.label) problems.push("label is required");
    if (entry?.id && entry.id === entry.label) problems.push("id and label must be distinct concepts");
    if (!ACTION_KIND.includes(entry?.kind)) problems.push(`kind "${entry?.kind}" is not a known ACTION_KIND`);

    if (entry?.kind === "GOVERNED_COMMAND") {
      // The two facts that make a write traceable: what it calls, and what that call
      // requires. Without the capability id, nothing downstream can even ask the
      // resolver the right question, and the affordance would render unconditionally.
      if (!entry.command) problems.push("a GOVERNED_COMMAND must name the command it dispatches");
      if (!entry.capabilityRequirement) {
        problems.push("a GOVERNED_COMMAND must declare its capabilityRequirement (declaration, not a decision)");
      }
    } else {
      if (entry?.command) problems.push(`kind ${entry.kind} must not name a command — only GOVERNED_COMMAND writes`);
    }

    // A handler is permitted, but it must be code registered by the application. The
    // guard that matters is elsewhere: a DEFINITION can only ever hold an id string,
    // so no configuration path can reach this argument.
    if (entry?.handler !== undefined && typeof entry.handler !== "function") {
      problems.push("handler, if present, must be a function supplied by application code");
    }
    return problems;
  }
}

export const componentRegistry = new ComponentRegistry();
export const actionRegistry = new ActionRegistry();

/**
 * Every component and action id a definition references.
 *
 * Exists so a definition can be checked against the registry BEFORE it renders.
 * Discovering an unregistered component at paint time means a broken section in front of
 * a user; discovering it in a validator means a failed build.
 *
 * Column `renderer` is deliberately NOT read here: it was removed from the list-view
 * contract, and validateListViewDefinition now rejects a column that declares one. Keeping
 * a lookup for a property no valid definition can carry would be the same dead-declaration
 * shape the removal was meant to end.
 */
export function referencedRegistryIds(def = {}) {
  const components = new Set();
  const actions = new Set();
  for (const region of def.regions ?? []) if (region?.componentId) components.add(region.componentId);
  for (const a of def.rowActions ?? []) if (typeof a === "string") actions.add(a);
  for (const a of def.actions ?? []) if (typeof a === "string") actions.add(a);
  return { components: [...components].sort(), actions: [...actions].sort() };
}

/** Validate that everything a definition references is actually registered. */
export function validateRegistryReferences(def) {
  const problems = [];
  const at = def?.id ? `definition ${def.id}` : "definition";
  const { components, actions } = referencedRegistryIds(def);
  for (const id of components) {
    if (!componentRegistry.has(id)) problems.push(`${at}: references unregistered component "${id}"`);
  }
  for (const id of actions) {
    if (!actionRegistry.has(id)) problems.push(`${at}: references unregistered action "${id}"`);
  }
  return problems;
}

/**
 * The capability ids a definition's actions declare — handed to the real resolver.
 * §6: this returns ids, never decisions. Nothing here evaluates authority.
 */
export function declaredActionCapabilities(def) {
  const out = new Set();
  for (const id of referencedRegistryIds(def).actions) {
    const entry = actionRegistry.resolve(id);
    if (entry?.capabilityRequirement) out.add(entry.capabilityRequirement);
  }
  return [...out].sort();
}
