import { getSettings } from "@/repository/appSettings";
import SectionOrderForm from "@/forms/SectionOrderForm";
import { requireAdminTab } from "@/lib/adminAccess";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { normalizeSectionOrder } from "@/lib/projectSections";
import { projectSectionLabels } from "@/lib/projectSectionLabels";

// Section-order tab: drag-and-drop ordering of the project detail sections.
// Gated by settings.manage (locked to SUPERADMIN).
export default async function AdminSettingsSectionsPage() {
  await requireAdminTab("settings");
  const t = getDictionary(await getLocale());
  const settings = await getSettings();

  return <SectionOrderForm order={normalizeSectionOrder(settings.projectSectionOrder)} labels={projectSectionLabels(t)} />;
}
