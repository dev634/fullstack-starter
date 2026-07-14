import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { getSettings } from "@/repository/appSettings";
import AppSettingsForm from "@/forms/AppSettingsForm";
import LogoUploadForm from "@/forms/LogoUploadForm";
import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function AdminSettingsPage() {
  const session = await auth();
  if (!hasMinRole(session?.user?.role, "SUPERADMIN")) {
    redirect("/clients");
  }

  const t = getDictionary(await getLocale());
  // Fetched fresh (not the cached lib/appSettings wrapper) — this is the
  // SUPERADMIN's own edit page, so it must reflect the very latest values.
  const settings = await getSettings();

  return (
    <main className="flex flex-1 min-h-0 flex-col justify-start overflow-y-auto py-8">
      <div className="w-full max-w-2xl mx-auto space-y-4 px-6">
        <h1 className="text-3xl font-bold">{t.appSettings.title}</h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">{t.appSettings.subtitle}</p>
        <LogoUploadForm logoUrl={settings.logoUrl} />
        <AppSettingsForm
          appName={settings.appName}
          primaryColor={settings.primaryColor}
          accentColor={settings.accentColor}
        />
      </div>
    </main>
  );
}
