/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Geometric sans-serif used for the "PRECISE" brand wordmark.
        brand: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Primary accent — unified BLUE ramp (matches the charcoal chrome + tab accent). This was
        // formerly an Asana-style coral; redefining the single `brand` token recolors every
        // `brand-*` usage app-wide (buttons, links, badges, project spine, focus ring, logo) to blue
        // in one place, so the whole product speaks one accent. Mirrors Tailwind's default blue.
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
    },
  },
  plugins: [],
};
