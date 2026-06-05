"use client";

/**
 * paikko `<PaikkoNav>` - a small global navigation pill that sits beside the
 * `<ReportButton>` FAB and links to the review queue at `/tickets`.
 *
 * It is mounted app-wide (alongside `<ReportButton>` in `<PaikkoProvider>`) so
 * the user can reach the queue from anywhere. It is deliberately visually
 * secondary to the Report FAB - an outlined dark pill rather than the solid
 * primary fill - so Report stays the one-tap prominent action.
 *
 * Layout: the FAB lives at `right:20 bottom:20` (~78px wide). This pill sits
 * just to its LEFT at `right:108 bottom:20`, clear of both the FAB and the
 * report confirmation panel (which anchors at `right:20 bottom:76`).
 *
 * It is tagged `data-paikko-ui` so the capture controller ignores clicks on it
 * (point-mode skips anything inside `[data-paikko-ui]`).
 *
 * When already on `/tickets` it flips to a "Calculator" pill linking back to
 * `/calc`, so the cluster is never a dead end.
 */
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function PaikkoNav(): React.JSX.Element {
  const pathname = usePathname();
  const onTickets = pathname === "/tickets" || pathname?.startsWith("/tickets/");

  const href = onTickets ? "/calc" : "/tickets";
  const label = onTickets ? "Calculator" : "Tickets";

  return (
    <div data-paikko-ui="nav" style={styles.root}>
      <Link
        href={href}
        data-paikko-ui="nav-link"
        style={styles.pill}
        aria-label={onTickets ? "Back to calculator" : "Review tickets"}
      >
        {label}
      </Link>
    </div>
  );
}

const Z = 2147483000; // match the ReportButton stacking context

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: Z,
    fontFamily:
      "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  },
  pill: {
    position: "fixed",
    right: 108, // just left of the FAB (right:20, ~78px wide) - never overlaps
    bottom: 20,
    pointerEvents: "auto",
    display: "inline-flex",
    alignItems: "center",
    padding: "10px 16px",
    borderRadius: 999,
    // Outlined / lighter so it reads as secondary to the solid Report FAB.
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(17,24,39,0.85)",
    color: "#e5e7eb",
    fontSize: 14,
    fontWeight: 600,
    textDecoration: "none",
    cursor: "pointer",
    boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
    whiteSpace: "nowrap",
  },
};

export default PaikkoNav;
