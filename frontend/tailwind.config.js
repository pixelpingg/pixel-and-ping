/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: {
          950: "#070B14",
          900: "#0B1120",
          800: "#111A2E",
          700: "#1A2540",
          600: "#243252",
        },
        brand: {
          cyan: "#339BFB",
          blue: "#305DE3",
          purple: "#620A9A",
          magenta: "#D323EA",
        },
        signal: {
          teal: "#2DD4BF",
          indigo: "#6366F1",
          amber: "#F59E0B",
          rose: "#FB7185",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        glow: "0 0 24px 0 rgba(45, 212, 191, 0.25)",
      },
      backgroundImage: {
        "ping-gradient": "linear-gradient(135deg, #2023A5 0%, #305DE3 35%, #339BFB 55%, #620A9A 78%, #D323EA 100%)",
        "radar-grid":
          "radial-gradient(circle at center, rgba(45,212,191,0.08) 0%, transparent 70%)",
      },
      animation: {
        "ping-slow": "ping 2.4s cubic-bezier(0,0,0.2,1) infinite",
        "pulse-slow": "pulse 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
