import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// Two build targets need two different `base` paths:
// - GitHub Pages (default `vite build`, used by .github/workflows/deploy-field-ops.yml)
//   serves this app from a subpath, so assets must reference "/Taylor_Parts/field-ops/".
// - Firebase Hosting preview channels (`vite build --mode firebase-preview`,
//   see scripts/deploy-preview.sh) serve from the root of their own generated
//   URL, so assets must reference "/". Mixing these up is exactly what left
//   Firebase Hosting broken previously (assets built for the GH Pages subpath
//   don't resolve when served from a channel/hosting root).
export default defineConfig(({ mode }) => {
  const isFirebasePreview = mode === "firebase-preview";
  return {
    base: isFirebasePreview ? "/" : "/Taylor_Parts/field-ops/",
    plugins: [react()],
    server: {
      allowedHosts: ['.loca.lt', '.trycloudflare.com'],
    },
    build: {
      chunkSizeWarningLimit: 800,
      outDir: isFirebasePreview ? "dist-firebase" : "dist",
    },
  };
})
