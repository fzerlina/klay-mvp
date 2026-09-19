import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// MVP prototype — hosted on GitHub Pages at https://fzerlina.github.io/klay-mvp/,
// so the production build needs all asset URLs prefixed with /klay-mvp/. The dev
// server (npm run dev) ignores `base` and serves from /.
export default defineConfig({
  base: "/klay-mvp/",
  plugins: [react()],
  server: {
    // Vite does not read PORT on its own. Honouring it lets a harness that
    // assigns a free port (two forks of this app often run side by side) land
    // the server where it expects, instead of Vite defaulting to 5173.
    port: Number(process.env.PORT) || undefined,
  },
});
