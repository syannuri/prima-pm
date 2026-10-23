export default {
  plugins: {
    // Tailwind v4 moved its PostCSS plugin to a separate package and now handles
    // vendor prefixing internally, so autoprefixer is no longer wired in here.
    '@tailwindcss/postcss': {},
  },
};
