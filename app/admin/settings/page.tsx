import { getSettings } from "@/repository/appSettings";
import AppSettingsForm from "@/forms/AppSettingsForm";
import LogoUploadForm from "@/forms/LogoUploadForm";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Theme tab: logo, app name, primary/accent colors, and the live preview.
// The SUPERADMIN gate and the page title live in the shared layout.
export default async function AdminSettingsThemePage() {
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
