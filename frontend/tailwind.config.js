/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbe8f7',
          200: '#bfd8ed',
          300: '#94c1e6',
          400: '#62a9df',
          500: '#3395db',
          600: '#1473c9',
          700: '#0c5aa8',
          800: '#0f4d81',
          900: '#0f3b5f',
        },
        dark: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        // Latar bertingkat tema gelap: 950 = dasar halaman, 700 = panel paling terang.
        ink: {
          950: '#04060e',
          900: '#070c18',
          800: '#0b1120',
          700: '#111a2e',
        },
        // Warna aksen "aurora" yang dipakai untuk cahaya, garis, dan gradien.
        aurora: {
          cyan: '#22d3ee',
          teal: '#2dd4bf',
          blue: '#3b82f6',
          violet: '#8b5cf6',
          fuchsia: '#d946ef',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Dipakai untuk angka kuota, label HUD, prompt, dan kode.
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glass: '0 24px 60px -32px rgba(2, 6, 23, 0.95)',
        'glow-cyan': '0 0 0 1px rgba(34, 211, 238, 0.22), 0 18px 50px -18px rgba(34, 211, 238, 0.55)',
        'glow-violet': '0 0 0 1px rgba(139, 92, 246, 0.22), 0 18px 50px -18px rgba(139, 92, 246, 0.55)',
        'inner-line': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.07)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in',
        rise: 'riseIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
        drift: 'drift 28s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 3.2s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        riseIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(2.5rem, -2rem, 0) scale(1.08)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-120% 0' },
          '100%': { backgroundPosition: '220% 0' },
        },
      },
    },
  },
  plugins: [],
}
