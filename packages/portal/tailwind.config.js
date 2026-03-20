/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Traffic light system
        status: {
          processed: '#34C759',  // Green
          pending: '#FF9500',    // Yellow/amber
          rejected: '#FF3B30',   // Red
        },
      },
    },
  },
  plugins: [],
};
