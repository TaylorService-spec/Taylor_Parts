import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[a-z]+$/.test(spec)) {
    const base = new URL(spec, ctx.parentURL);
    for (const ext of [".ts", ".js", ".mjs", "/index.ts"]) {
      const cand = new URL(base.href + ext);
      if (existsSync(fileURLToPath(cand))) return next(base.href + ext, ctx);
    }
  }
  return next(spec, ctx);
}
