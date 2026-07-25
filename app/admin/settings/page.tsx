import { getSettings } from "@/repository/appSettings";
import AppSettingsForm from "@/forms/AppSettingsForm";
import LogoUploadForm from "@/forms/LogoUploadForm";
import { requireAdminTab } from "@/lib/adminAccess";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Theme tab: logo, app name, primary/accent colors, and the live preview.
// Gated by settings.manage (locked to SUPERADMIN); a role without it is sent
// to the first Administration tab it can open.
export default async function AdminSettingsThemePage() {
  await requireAdminTab("settings");
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
