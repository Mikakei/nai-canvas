import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = `http://127.0.0.1:${process.env.SERVER_PORT || 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': server, '/outputs': server, '/uploads': server, '/thumb': server },
  },
});
