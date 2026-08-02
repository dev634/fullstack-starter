import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * Landing page for an authenticated, non-CLIENT user whose job function
 * hides every top-level rubrique — the fallback lib/areaAccess.ts's
 * `firstAccessibleAreaHref` redirects to when nothing (not even Admin) is
 * left to land on. Without this page, that fallback used to be "/login",
 * which renders a sign-in form for an already-authenticated session — a
 * misleading dead end that looks like the login failed.
 *
 * Deliberately NOT gated by `requireAreaOrRedirect`/an area check: every
 * rubrique being hidden is exactly the situation that lands here, so gating
 * this page on one would bounce straight back to itself. Only a session is
 * required; a CLIENT login is sent to its own portal, the same rule every
 * other non-portal page applies (see lib/portal.ts::blockClientFromApp).
 */
export default async function AccessDeniedPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role === "CLIENT") redirect("/portail");

  const t = getDictionary(await getLocale());

  return (
    <main className="flex flex-1 min-h-0 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
      <div className="w-full max-w-sm mx-auto space-y-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t.accessDenied.title}</h1>
        <p className="text-gray-500 dark:text-gray-400">{t.accessDenied.message}</p>
        <div className="pt-2">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
