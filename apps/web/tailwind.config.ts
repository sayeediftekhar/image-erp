import type { Config } from 'tailwindcss'

// tailwind.config.ts is read by the Tailwind PostCSS plugin — unrelated to Next.js
// config loading (next.config.mjs). TypeScript config is supported in Tailwind v3.3+.
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Brand tokens — both map to CSS custom properties so Sayeed can tune the
        // exact shades in globals.css without touching TypeScript.
        'navy-deep':  'var(--navy-deep)',   // large surfaces: sidebar, dark headers
        'navy-vivid': 'var(--navy-vivid)',  // small accents: buttons, active nav, avatar
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
