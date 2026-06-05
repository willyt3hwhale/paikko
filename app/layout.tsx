import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "paikko",
  description: "Point at the bug. The agent fixes it.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
