/** @type {import('tailwindcss').Config} */
// Design tokens: design-system/MASTER.md. Light theme. `indigo` is remapped to the
// apexcoder deep-blue brand so existing indigo-* utilities render as brand without renames.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/web-shared/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Deep-blue brand ramp (remaps default indigo). Anchored on Codility-style #0052A3.
        indigo: {
          50: '#EFF5FB',
          100: '#D6E5F5',
          200: '#AECBEA',
          300: '#7FAEDE',
          400: '#3D82C4',
          500: '#0066CC',
          600: '#0052A3',
          700: '#004385',
          800: '#003467',
          900: '#002A54',
          950: '#001B36',
        },
      },
    },
  },
  plugins: [],
}
