/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          500: '#4f6ef7',
          600: '#3d5de4',
          700: '#2e4dc8',
        },
        surface: {
          900: '#0f1117',
          800: '#161b27',
          700: '#1e2536',
          600: '#252d42',
          500: '#2e3854',
        },
        accent: {
          green:  '#22c55e',
          yellow: '#f59e0b',
          red:    '#ef4444',
          purple: '#a855f7',
          orange: '#f97316',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
