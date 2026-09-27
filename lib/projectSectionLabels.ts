import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { ProjectSectionKey } from "@/lib/projectSections";

/**
 * Localized headings for the project-detail sections, keyed by section key —
 * the same headings the project page renders, for every key EXCEPT `interims`.
 * Shared by the section-order tab and the per-function visibility config so
 * the labels never drift.
 *
 * `interims` is the one deliberate exception: that key also gates the
 * travailleurs (ProjectWorker) picker/count (docs/CONVENTIONS.md — no
 * dedicated "workers" section key exists), so an admin unchecking it in
 * either screen hides employees too, not only intérimaires. Both admin
 * screens say so explicitly (`t.jobFunctions.sections.interimsAndWorkersLabel`)
 * — the workforce page's own heading (`t.projects.detail.interimsHeading`)
 * is untouched and stays "Intérimaires".
 */
export function projectSectionLabels(t: Dictionary): Record<ProjectSectionKey, string> {
  return {
    tasks: t.projects.detail.tasksHeading,
    materials: t.projects.detail.materialsHeading,
    interventions: t.projects.detail.interventionsHeading,
    subcontractors: t.projects.detail.subcontractorsHeading,
    interims: t.jobFunctions.sections.interimsAndWorkersLabel,
    files: t.projects.detail.filesHeading,
    reserves: t.reserves.heading,
  };
}
