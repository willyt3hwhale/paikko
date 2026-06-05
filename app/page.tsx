import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-neutral-100 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-4xl font-semibold text-neutral-900">paikko</h1>
        <p className="text-neutral-500">Point at the bug. The agent fixes it.</p>
      </div>
      <nav className="flex w-full max-w-xs flex-col gap-3">
        <Link
          href="/calc"
          className="rounded-xl bg-amber-500 px-5 py-3 text-center font-medium text-white transition-colors hover:bg-amber-400"
        >
          Open the calculator
        </Link>
        <Link
          href="/tickets"
          className="rounded-xl bg-white px-5 py-3 text-center font-medium text-neutral-800 ring-1 ring-neutral-200 transition-colors hover:bg-neutral-50"
        >
          Review reported issues
        </Link>
      </nav>
    </main>
  );
}
