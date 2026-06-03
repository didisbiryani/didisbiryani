/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./admin.html",
    "./cart.html",
    "./checkout.html",
    "./dashboard.html",
    "./delivery.html",
    "./kds.html",
    "./payment.html",
    "./js/**/*.js"
  ],
  theme: {
    extend: {
        colors: {
            brand: { black: '#0a0a0a', gold: '#d4a017', red: '#c1121f', white: '#fdfdfd' }
        },
        fontFamily: { sans: ['Inter', 'sans-serif'] }
    }
  },
  plugins: [],
}
