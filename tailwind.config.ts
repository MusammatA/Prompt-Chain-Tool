import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ["class"],
  theme: {
    extend: {
      boxShadow: {
        panel: "0 24px 60px rgba(15, 23, 42, 0.18)",
        glow: "0 0 0 1px rgba(255,255,255,0.1), 0 24px 40px rgba(15, 23, 42, 0.24)",
      },
      colors: {
        sand: "#f2ebdf",
        ink: "#132630",
        tide: "#0f2534",
        coral: "#ea6e45",
        citron: "#a7cc58",
        lagoon: "#77b5d9",
      },
    },
  },
  plugins: [],
};

export default config;
