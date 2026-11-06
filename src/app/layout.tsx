import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

import "./globals.css";
import { SmoothScroll } from "../components/providers/smooth-scroll";

export const metadata: Metadata = {
  title: "E2EE Share — Secure P2P File Sharing",
  description:
    "End-to-end encrypted file transfer directly between browsers. The server never sees your files or keys.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className="dark"
      style={
        {
          "--font-sans": GeistSans.variable,
          "--font-mono": GeistMono.variable,
        } as React.CSSProperties
      }
    >
      <body className="font-sans bg-background text-foreground min-h-screen antialiased">
        <SmoothScroll>
          <main className="flex min-h-screen flex-col items-center justify-start px-4 py-10">
            {children}
          </main>
        </SmoothScroll>
      </body>
    </html>
  );
}
