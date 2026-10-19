/** @type {import('tailwindcss').Config} */

/**
 * The design system.
 *
 * Every colour here comes from the logo: navy for structure, teal for action,
 * lime for money and success. Screens used to choose their own greys and blues
 * — up to eight on one page — which is most of why they did not look like one
 * product. Use these names, not raw hex values or Tailwind's stock blues.
 *
 *   navy  — sidebar, headings, the total block
 *   teal  — primary buttons, focus rings, the active item
 *   lime  — totals, change, "done", anything about money coming in
 *   slate — everything neutral (Tailwind's own, kept for consistency)
 *
 * Contrast: white text sits on teal-700 and darker, never on the logo teal
 * (#0e9da0, teal-600), which falls short of 4.5:1 for normal-size text.
 */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#eef4fa', 100: '#d6e4f1', 200: '#adc8e3', 300: '#7ea6cf', 400: '#4f80b5',
          500: '#2f6299', 600: '#1f4c7d', 700: '#173f69', 800: '#12385f', 900: '#0d2a48', 950: '#081a2e',
        },
        teal: {
          50: '#ecfbfb', 100: '#cdf3f3', 200: '#9fe6e6', 300: '#67d2d3', 400: '#31b8ba',
          500: '#12aeb1', 600: '#0e9da0', 700: '#0c7f82', 800: '#0f6567', 900: '#115356', 950: '#043438',
        },
        lime: {
          50: '#f5fbea', 100: '#e8f5d0', 200: '#d2eba6', 300: '#b5dc72', 400: '#9ccd4c',
          500: '#8bc53f', 600: '#6ba12b', 700: '#527b24', 800: '#436222', 900: '#3a5321', 950: '#1d2e0d',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      boxShadow: {
        // Quiet by default: a card should read as a surface, not float.
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06)',
        raised: '0 4px 12px rgb(15 23 42 / 0.08), 0 2px 4px rgb(15 23 42 / 0.05)',
        focus: '0 0 0 3px rgb(14 157 160 / 0.25)',
      },
    },
  },
  plugins: [],
};
