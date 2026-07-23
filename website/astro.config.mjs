import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// Placeholder until a real domain is attached (see PLAN.md > Deployment).
// Update `site` before enabling the sitemap/canonical URLs for real.
export default defineConfig({
  site: 'https://trustflow-site.netlify.app',
  output: 'static',
  // Some static hosts (e.g. Hostinger's file manager / zip-extract step)
  // drop or block the default `_astro/` output folder because of its
  // leading underscore. Renaming it avoids that class of 404 entirely.
  build: {
    assets: 'build-assets',
  },
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap(),
  ],
});
