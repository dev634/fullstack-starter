import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import AdminSettingsNav from "@/components/AdminSettingsNav";

// Shared chrome for the SUPERADMIN settings sub-pages: the role gate (so it's
// enforced once for every tab), the page title, and the tab navigation. Each
// child page renders only its own section (Theme / Section order).
export default async function AdminSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!hasMinRole(session?.user?.role, "SUPERADMIN")) {
    redirect("/clients");
  }

  const t = getDictionary(await getLocale());

  return (
    <main className="flex flex-1 min-h-0 flex-col justify-start overflow-y-auto py-8">
      <div className="w-full max-w-2xl mx-auto space-y-4 px-6">
        <h1 className="text-3xl font-bold">{t.appSettings.title}</h1>
        <AdminSettingsNav />
        {children}
      </div>
    </main>
  );
}
