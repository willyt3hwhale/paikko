import { redirect } from "next/navigation";

/**
 * Backend root.
 *
 * The paikko backend serves only the review surface (the /tickets dashboard) and
 * the /api/** intake + review endpoints - never an end-user app. There is no
 * landing page here: '/' redirects straight to the review dashboard. The demo
 * calculator that used to live behind this app is now a separate consumer
 * (examples/calculator) that POSTs reports here cross-origin.
 */
export default function Home() {
  redirect("/tickets");
}
