import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // bind 0.0.0.0 so other machines on the LAN can reach the dev server
    proxy: {
      // Dev convenience: forward API calls to the Express backend.
      '/api': 'http://localhost:4000',
    },
  },
});
