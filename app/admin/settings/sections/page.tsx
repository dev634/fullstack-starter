import { getSettings } from "@/repository/appSettings";
import SectionOrderForm from "@/forms/SectionOrderForm";
import { requireAdminTab } from "@/lib/adminAccess";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { normalizeSectionOrder, type ProjectSectionKey } from "@/lib/projectSections";

// Section-order tab: drag-and-drop ordering of the project detail sections.
// Gated by settings.manage (locked to SUPERADMIN).
export default async function AdminSettingsSectionsPage() {
  await requireAdminTab("settings");
  const t = getDictionary(await getLocale());
  const settings = await getSettings();

  // Localized labels for the reorderable project sections, keyed by section
  // key — reuses the same headings the project page renders.
  const sectionLabels: Record<ProjectSectionKey, string> = {
    tasks: t.projects.detail.tasksHeading,
    materials: t.projects.detail.materialsHeading,
    interventions: t.projects.detail.interventionsHeading,
    subcontractors: t.projects.detail.subcontractorsHeading,
    interims: t.projects.detail.interimsHeading,
    files: t.projects.detail.filesHeading,
    reserves: t.reserves.heading,
  };

  return <SectionOrderForm order={normalizeSectionOrder(settings.projectSectionOrder)} labels={sectionLabels} />;
}
