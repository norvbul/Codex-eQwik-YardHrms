import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.HRMS_WEB_PORT || 5173),
    proxy: { '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000' },
  },
  build: { outDir: 'dist' },
});
