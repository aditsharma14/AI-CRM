/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // See the design-system writeup for the reasoning behind each color —
      // short version: teal is the brand, violet means "AI touched this,"
      // and background/surface/card are three deliberate depth levels.
      colors: {
        background: { DEFAULT: '#F8FAFC', dark: '#0B0F14' },
        surface: { DEFAULT: '#FFFFFF', dark: '#111827' },
        card: { DEFAULT: '#FFFFFF', dark: '#161E2A' },
        border: { DEFAULT: '#E2E8F0', dark: '#1F2937' },
        text: { DEFAULT: '#0F172A', dark: '#F1F5F9' },
        muted: { DEFAULT: '#64748B', dark: '#94A3B8' },
        primary: {
          DEFAULT: '#0D9488',
          dark: '#14B8A6',
          50: '#F0FDFA',
          100: '#CCFBF1',
        },
        secondary: { DEFAULT: '#334155', dark: '#94A3B8' },
        accent: {
          DEFAULT: '#8B5CF6',
          dark: '#A78BFA',
          50: '#F5F3FF',
          100: '#EDE9FE',
        },
        success: { DEFAULT: '#16A34A', dark: '#4ADE80' },
        warning: { DEFAULT: '#D97706', dark: '#FBBF24' },
        danger: { DEFAULT: '#DC2626', dark: '#F87171' },
      },
      fontFamily: {
        serif: ['ui-serif', 'Georgia', 'serif'],
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      fontSize: {
        xs: '0.75rem',
        sm: '0.8125rem',
        base: '0.875rem',
        md: '1rem',
        lg: '1.25rem',
        xl: '1.75rem',
        '2xl': '2.25rem',
      },
      boxShadow: {
        // Soft, low-spread shadows only — no harsh drop-shadows anywhere.
        soft: '0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 16px rgba(15, 23, 42, 0.06)',
        'soft-dark': '0 1px 2px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.3)',
      },
      borderRadius: {
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
      },
    },
  },
  plugins: [],
}
