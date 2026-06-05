import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "paikko review",
  description: "paikko review dashboard.",
};

/**
 * Backend root layout.
 *
 * Deliberately does NOT mount <PaikkoProvider> / the report widget: the backend
 * is the review + intake surface, not an app a user reports bugs *on*. The widget
 * lives in @paikko/widget and is mounted by consumer apps (examples/calculator),
 * which point it at this backend's /api/reports endpoint cross-origin.
 */
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
