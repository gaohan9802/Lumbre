import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Day Mode — Girl's Dream
        day: {
          bg: '#FFF5F0',
          card: '#FFFFFF',
          sky: '#84BECA',       // Diamond
          pink: '#EF4067',      // Heartbeat — primary accent, buttons
          lemon: '#FEDAB8',     // Banana — warm cream highlights
          honey: '#F3A4AC',     // Girl's Dream — soft pink decorative
          heart: '#BE0001',     // Sweet Honey — deep red emphasis
          text: '#5C4B51',
          muted: '#9B8E93',
        },
        // Night Mode — 雪豹夜行 Snow Leopard
        night: {
          bg: '#0f1419',        // Base — page background
          card: '#1c2630',      // Surface — cards/modules
          surface: '#243040',   // Elevated — overlays/popups/dropdowns
          amber: '#e2a84b',     // Amber — buttons/highlights/active
          amberGlow: '#f5c96b', // Amber Glow — small glow/notification dots
          amberDim: '#c48a30',  // Amber Dim — hover/secondary emphasis
          text: '#e8e4df',      // Primary text
          muted: '#8899a6',     // Secondary text/timestamps/labels
          disabled: '#4d5b6a',  // Disabled/placeholder
          border: '#2e3d4d',    // Divider/border
          success: '#4a9e7e',
          warning: '#d4915c',
          error: '#c45c5c',
          info: '#5b8fb4',
        },
        // Receipt / Todo
        receipt: {
          paper: '#F5F0E8',
          ink: '#4A3728',
          stamp: '#C45C48',
          line: '#D4C9BC',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        receipt: ['"Courier Prime"', '"Courier New"', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
export default config
