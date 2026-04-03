import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Humor Flavor Studio",
  description: "Admin studio for building humor flavors, prompt chains, and caption tests.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {`
            try {
              var stored = window.localStorage.getItem("humor_admin_theme");
              var mode = stored === "light" || stored === "dark" || stored === "system" ? stored : "light";
              var resolved = mode === "system"
                ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
                : mode;
              document.documentElement.dataset.themeMode = mode;
              document.documentElement.classList.toggle("dark", resolved === "dark");
            } catch (error) {}
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}
