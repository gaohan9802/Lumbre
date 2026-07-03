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
          bg: '#FFF9F5',        // Base — page background
          card: '#FFFFFF',      // Surface — cards/modules
          tint: '#FEF3EC',      // Tinted BG — section/sidebar background
          border: '#F0E4DD',    // Divider/border
          sky: '#84BECA',       // Diamond — links/info/cool contrast
          skyLight: '#E6F3F6',  // Diamond Light — info bg/cool tag bg
          pink: '#EF4067',      // Heartbeat — primary accent, buttons
          pinkLight: '#FDE8ED', // Heartbeat Light — hover/light button bg
          pinkDeep: '#D63656',  // Heartbeat Deep — button hover (solid, no opacity)
          errorLight: '#F9E3E3',// Sweet Honey Light — error hover bg (solid)
          lemon: '#FEDAB8',     // Banana — tag bg/badge/warm hint bg
          honey: '#F3A4AC',     // Girl's Dream — selected highlight/progress
          heart: '#BE0001',     // Sweet Honey — error/delete
          text: '#5D4037',      // Primary text — deep brown
          muted: '#8D7468',     // Secondary text/timestamps — mid brown
          disabled: '#C9B8AF',  // Placeholder/disabled
          success: '#4a9e7e',
          warning: '#E8943A',
          error: '#BE0001',
          info: '#84BECA',
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
      fontSize: {
        xs: ['0.72rem', { lineHeight: '1.5' }],
        sm: ['0.83rem', { lineHeight: '1.65' }],
        base: ['0.93rem', { lineHeight: '1.7' }],
        lg: ['1.05rem', { lineHeight: '1.6' }],
        xl: ['1.15rem', { lineHeight: '1.5' }],
        '2xl': ['1.35rem', { lineHeight: '1.4' }],
        '3xl': ['1.65rem', { lineHeight: '1.3' }],
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
