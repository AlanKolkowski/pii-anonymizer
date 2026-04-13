import { defineConfig } from 'vite';

export default defineConfig({
  base: '/pii-anonymizer/',
  server: {
    host: true,
  },
  test: {
    globals: true,
  },
});
