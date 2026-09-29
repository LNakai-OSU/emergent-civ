import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // The GitHub Pages deploy (see .github/workflows/pages.yml) lives under
  // /emergent-civ/ instead of the root that local dev serves from.
  base: process.env.GITHUB_PAGES ? '/emergent-civ/' : '/',
  plugins: [react()],
})
