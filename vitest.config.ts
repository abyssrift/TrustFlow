import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // We're testing the Supabase client logic/DB, not the DOM
    include: ['tests/**/*.test.ts'],
    alias: {
      '@': path.resolve(__dirname, './'),
    },
    testTimeout: 60000, // Supabase operations might be slow
  },
});
