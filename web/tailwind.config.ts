import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0b0f14',
          raised: '#12181f',
          border: '#232b35',
        },
      },
    },
  },
  plugins: [],
};

export default config;
