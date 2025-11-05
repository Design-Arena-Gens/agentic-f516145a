/**** @type {import('tailwindcss').Config} ****/
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0b0f1a",
        panel: "#111827",
        accent: "#6ee7b7",
        accent2: "#93c5fd"
      }
    },
  },
  plugins: [],
}
