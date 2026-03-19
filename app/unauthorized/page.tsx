import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <section className="panel max-w-xl rounded-[2rem] p-8 text-center sm:p-10">
        <p className="text-xs uppercase tracking-[0.3em] text-[var(--ink-soft)]">Access denied</p>
        <h1 className="mt-4 text-4xl font-semibold">This admin studio is restricted.</h1>
        <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">
          Your signed-in profile needs <code>profiles.is_superadmin = true</code> or <code>profiles.is_matrix_admin = true</code>.
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
