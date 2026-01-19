const forms = require('@tailwindcss/forms');

module.exports = {
  content: [
    './web/pages/**/*.html',
    './web/js/**/*.js',
    './node_modules/flowbite/**/*.js'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      colors: {
        brand: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12'
        }
      },
      boxShadow: {
        card: '0 20px 45px -35px rgba(15, 23, 42, 0.45)',
        glow: '0 10px 30px -18px rgba(249, 115, 22, 0.55)'
      }
    }
  },
  plugins: [forms, require('flowbite/plugin')]
};
