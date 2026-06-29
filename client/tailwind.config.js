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
        // Asana-style coral accent (full 50–900 ramp).
        brand: {
          50: '#fff1f1',
          100: '#ffe0df',
          200: '#ffc7c4',
          300: '#ffa19c',
          400: '#fb7d77',
          500: '#f4675f',
          600: '#e34f4a',
          700: '#be3b39',
          800: '#9d3331',
          900: '#822f2e',
        },
      },
    },
  },
  plugins: [],
};
