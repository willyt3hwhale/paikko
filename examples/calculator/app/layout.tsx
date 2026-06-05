import type { Metadata } from "next";
import "./globals.css";
import { PaikkoMount } from "./PaikkoMount";

export const metadata: Metadata = {
  title: "paikko calculator demo",
  description:
    "A plain Next 15 calculator that mounts the paikko widget and reports to the paikko backend.",
};

/**
 * Root layout for the example consumer app.
 *
 * Mounts the paikko widget once here (via the <PaikkoMount> client island) so the
 * floating Report button and the Tickets nav pill appear on every page. This is
 * exactly the one-mount integration a real consumer does: the host app owns its
 * UI and state; paikko is a single dependency it drops in.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <PaikkoMount />
      </body>
    </html>
  );
}
