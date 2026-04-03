import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="cinema-page flex min-h-screen items-center justify-center px-6 py-10">
      <section className="panel max-w-xl rounded-[1.5rem] p-8 text-center sm:p-10">
        <p className="cinema-kicker text-xs font-medium text-[var(--ink-soft)]">Access denied</p>
        <h1 className="cinema-display mt-4 text-4xl font-semibold">This admin studio is restricted.</h1>
        <p className="mt-4 text-sm leading-6 text-[var(--ink-soft)]">
          Your profile needs <code>is_superadmin</code> or <code>is_matrix_admin</code>.
        </p>
        <Link
          href="/login"
          className="pill-button mt-8 inline-flex rounded-full bg-[linear-gradient(135deg,var(--brand),var(--brand-2))] px-5 py-3 text-sm font-semibold text-white"
        >
          Return to login
        </Link>
      </section>
    </main>
  );
}
