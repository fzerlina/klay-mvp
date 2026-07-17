import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// MVP prototype — hosted on GitHub Pages at https://fzerlina.github.io/klay-mvp/,
// so the production build needs all asset URLs prefixed with /klay-mvp/. The dev
// server (npm run dev) ignores `base` and serves from /.
export default defineConfig({
  base: "/klay-mvp/",
  plugins: [react()],
});
