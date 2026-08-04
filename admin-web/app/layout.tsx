import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoadQ · Admin",
  description: "LoadQ operations console — zones & queue management.",
};

export const viewport: Viewport = {
  themeColor: "#15171C",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
