// Same contract as the legacy `API_BASE_URL` constant in public/js/main.js.
// Override at build/dev time with VITE_API_BASE_URL.
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL || 'https://konstantins-portfolio.onrender.com';

// Set VITE_USE_BUNDLED_DATA=1 to skip the network fetch and use src/data/projects.json only.
export const USE_BUNDLED_DATA: boolean = import.meta.env.VITE_USE_BUNDLED_DATA === '1';
