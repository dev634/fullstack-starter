import { auth } from "@/lib/auth";
import { getAdminAccess } from "@/lib/adminAccess";
import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import AdminSettingsNav from "@/components/AdminSettingsNav";

// Shared chrome for the Administration area. Each tab is gated by a capability
// from the RBAC matrix (functions.manage / users.manage / settings.manage), so
// the area admits anyone who can open at least one tab; the tabs a role can't
// open are hidden here and self-guarded on their own pages.
export default async function AdminSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const access = await getAdminAccess(session?.user?.role);
  if (!access.any) {
    redirect("/clients");
  }

  const t = getDictionary(await getLocale());

  return (
    <main className="flex flex-1 min-h-0 flex-col justify-start overflow-y-auto py-8">
      <div className="w-full max-w-2xl mx-auto space-y-4 px-6">
        <h1 className="text-3xl font-bold">{t.nav.admin}</h1>
        <AdminSettingsNav access={access} />
        {children}
      </div>
    </main>
  );
}
