/**
 * Minimal 401 view for the review dashboard. Rendered by the `/tickets` server
 * components as a defense-in-depth fallback when the operator isn't authenticated
 * (the edge middleware normally challenges first; this guards the DB read in case
 * the middleware is bypassed or misconfigured). Plain server component - no state.
 */
export function UnauthorizedPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-neutral-900">Unauthorized</h1>
      <p className="mt-2 text-sm text-neutral-600">
        The review dashboard requires operator login. Set{" "}
        <code>PAIKKO_DASHBOARD_PASSWORD</code> on the backend and sign in, or run
        with <code>PAIKKO_AUTH=disabled</code> for local single-tenant dev. See{" "}
        <code>AUTH.md</code>.
      </p>
    </main>
  );
}

export default UnauthorizedPage;
