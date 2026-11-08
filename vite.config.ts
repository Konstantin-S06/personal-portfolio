import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works under a GitHub Pages project path.
export default defineConfig({
  base: './',
  plugins: [react()],
});
