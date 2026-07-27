import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// Live domain (see PLAN.md > Deployment). Drives canonical URLs + sitemap.
export default defineConfig({
  site: 'https://waitlist.trustedgellc.com',
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
