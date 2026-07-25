import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import AdminSettingsNav from "@/components/AdminSettingsNav";

// Shared chrome for the Administration area. Gated at ADMIN so admins can
// reach the Fonctions / Utilisateurs tabs; the SUPERADMIN-only tabs (Theme /
// Section order) gate themselves and are hidden from the tab bar for admins.
export default async function AdminSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = session?.user?.role;
  if (!hasMinRole(role, "ADMIN")) {
    redirect("/clients");
  }

  const t = getDictionary(await getLocale());

  return (
    <main className="flex flex-1 min-h-0 flex-col justify-start overflow-y-auto py-8">
      <div className="w-full max-w-2xl mx-auto space-y-4 px-6">
        <h1 className="text-3xl font-bold">{t.nav.admin}</h1>
        <AdminSettingsNav isSuperadmin={hasMinRole(role, "SUPERADMIN")} />
        {children}
      </div>
    </main>
  );
}
