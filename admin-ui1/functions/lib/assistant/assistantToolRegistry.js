"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantToolRegistry = void 0;
class AssistantToolRegistry {
    tools = new Map();
    gaps = [];
    register(tool) {
        if (this.tools.has(tool.id))
            throw new Error(`duplicate assistant tool id: ${tool.id}`);
        if (tool.requires.length === 0) {
            // A tool requiring nothing is a public read, and there are none here -- every EOS business
            // object is governed. An empty requirement is far more likely to be an omission than a
            // deliberate design, and the cost of being wrong is unauthorized data reaching a model.
            throw new Error(`assistant tool "${tool.id}" declares no required capability; refusing to register`);
        }
        this.tools.set(tool.id, tool);
    }
    recordGap(gap) {
        this.gaps.push(gap);
    }
    get(toolId) {
        return this.tools.get(toolId);
    }
    /** Tools plausibly useful on a surface. Selection is NOT authorization. */
    forSurface(surface) {
        return [...this.tools.values()].filter((t) => t.surfaces.includes(surface));
    }
    all() {
        return [...this.tools.values()];
    }
    recordedGaps() {
        return [...this.gaps];
    }
    /** Every capability any registered tool can require. Used by tests and the usage report. */
    requiredCapabilities() {
        const out = new Set();
        for (const t of this.tools.values())
            for (const p of t.requires)
                out.add(p);
        return out;
    }
}
exports.AssistantToolRegistry = AssistantToolRegistry;
//# sourceMappingURL=assistantToolRegistry.js.map