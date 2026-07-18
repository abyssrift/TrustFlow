import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// Placeholder until a real domain is attached (see PLAN.md > Deployment).
// Update `site` before enabling the sitemap/canonical URLs for real.
export default defineConfig({
  site: 'https://trustflow-site.netlify.app',
  output: 'static',
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap(),
  ],
});
