import { getSettings } from "@/repository/appSettings";
import AppSettingsForm from "@/forms/AppSettingsForm";
import LogoUploadForm from "@/forms/LogoUploadForm";
import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Theme tab: logo, app name, primary/accent colors, and the live preview.
// SUPERADMIN-only — the layout gates the area at ADMIN, so this tab guards
// itself and sends admins back to the Fonctions tab.
export default async function AdminSettingsThemePage() {
  const session = await auth();
  if (!hasMinRole(session?.user?.role, "SUPERADMIN")) {
    redirect("/admin/settings/fonctions");
  }
  const t = getDictionary(await getLocale());
  // Fetched fresh (not the cached lib/appSettings wrapper) — this is the
  // SUPERADMIN's own edit page, so it must reflect the very latest values.
  const settings = await getSettings();

  return (
    <>
      <p className="text-sm text-gray-500 dark:text-gray-400">{t.appSettings.subtitle}</p>
      <LogoUploadForm logoUrl={settings.logoUrl} />
      <AppSettingsForm
        appName={settings.appName}
        primaryColor={settings.primaryColor}
        accentColor={settings.accentColor}
      />
    </>
  );
}
