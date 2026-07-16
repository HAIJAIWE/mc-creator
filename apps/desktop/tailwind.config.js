/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        mc: {
          bg: 'rgb(var(--mc-bg) / <alpha-value>)',
          surface: 'rgb(var(--mc-surface) / <alpha-value>)',
          'surface-2': 'rgb(var(--mc-surface-2) / <alpha-value>)',
          'surface-3': 'rgb(var(--mc-surface-3) / <alpha-value>)',
          border: 'rgb(var(--mc-border) / <alpha-value>)',
          'border-strong': 'rgb(var(--mc-border-strong) / <alpha-value>)',
          text: 'rgb(var(--mc-text) / <alpha-value>)',
          dim: 'rgb(var(--mc-text-dim) / <alpha-value>)',
          mute: 'rgb(var(--mc-text-mute) / <alpha-value>)',
          accent: 'rgb(var(--mc-accent) / <alpha-value>)',
          'accent-bright': 'rgb(var(--mc-accent-bright) / <alpha-value>)',
          'accent-deep': 'rgb(var(--mc-accent-deep) / <alpha-value>)',
          gold: 'rgb(var(--mc-gold) / <alpha-value>)',
          'gold-deep': 'rgb(var(--mc-gold-deep) / <alpha-value>)',
          redstone: 'rgb(var(--mc-redstone) / <alpha-value>)',
          'redstone-deep': 'rgb(var(--mc-redstone-deep) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: 'var(--mc-font-display)',
        sans: 'var(--mc-font-body)',
        mono: 'var(--mc-font-mono)',
      },
      borderRadius: {
        mc: 'var(--mc-radius)',
        'mc-lg': 'var(--mc-radius-lg)',
      },
      transitionTimingFunction: {
        mc: 'var(--mc-ease)',
      },
      boxShadow: {
        'mc-block': 'var(--mc-shadow-block)',
        'mc-block-active': 'var(--mc-shadow-block-active)',
        'mc-pop': 'var(--mc-shadow-pop)',
      },
      keyframes: {
        'mc-panel-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'mc-dialog-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'mc-toast-in': {
          '0%': { opacity: '0', transform: 'translateX(100%)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'mc-pop': {
          '0%': { transform: 'scale(0.9)' },
          '60%': { transform: 'scale(1.03)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'mc-panel-in': 'mc-panel-in 0.28s var(--mc-ease) both',
        'mc-dialog-in': 'mc-dialog-in 0.22s var(--mc-ease) both',
        'mc-toast-in': 'mc-toast-in 0.25s var(--mc-ease) both',
        'mc-pop': 'mc-pop 0.2s var(--mc-ease) both',
      },
    },
  },
  plugins: [],
};
