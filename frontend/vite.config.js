import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API runs on :5000 and is proxied, so the browser sees one origin
// and auth cookies work without cross-site settings.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // allow tenant subdomains like http://green-valley.localhost:5173
    allowedHosts: ['.localhost'],
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: false },
    },
  },
});
