import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ProjectSectionKey } from "@/lib/projectSections";

/**
 * Localized headings for the project-detail sections, keyed by section key —
 * the same headings the project page renders. Shared by the section-order tab
 * and the per-function visibility config so the labels never drift.
 */
export function projectSectionLabels(t: Dictionary): Record<ProjectSectionKey, string> {
  return {
    tasks: t.projects.detail.tasksHeading,
    materials: t.projects.detail.materialsHeading,
    interventions: t.projects.detail.interventionsHeading,
    subcontractors: t.projects.detail.subcontractorsHeading,
    interims: t.projects.detail.interimsHeading,
    files: t.projects.detail.filesHeading,
    reserves: t.reserves.heading,
  };
}
