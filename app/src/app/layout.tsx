import "./globals.css";

import type { Metadata } from "next";
import { Space_Grotesk, Space_Mono, Unbounded } from "next/font/google";

import { AppNav } from "@/components/layout/app-nav";

const unbounded = Unbounded({
  subsets: ["latin"],
  variable: "--font-unbounded",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  variable: "--font-space-mono",
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  description:
    "Launch prediction markets with virtual LMSR price discovery and band-pass graduation clearing.",
  title: {
    default: "Pop Charts",
    template: "%s | Pop Charts",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${unbounded.variable} ${spaceGrotesk.variable} ${spaceMono.variable}`}
      lang="en"
    >
      <body>
        <AppNav />
        <main className="mx-auto w-full max-w-[1240px] px-[18px] py-8 sm:px-7 sm:py-9">
          {children}
        </main>
      </body>
    </html>
  );
}
