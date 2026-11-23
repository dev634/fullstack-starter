import { canAccessArea } from "@/lib/areaAccess";
import { canAccessEverySection } from "@/lib/sectionAccess";

/**
 * May the caller PERMANENTLY delete? The one definition the trash pages use to
 * show or hide the "Supprimer définitivement" button, so that the button is
 * never offered when the server action would refuse it (a dead control).
 *
 * The actions enforce the same rules guard by guard (actions/projects
 * permanentlyDeleteProject, actions/clients permanentlyDeleteClient): a
 * destruction by cascade takes everything under the row, so the caller must be
 * allowed to see all of it —
 *   - a chantier: the `projects` rubrique and EVERY project section (tasks,
 *     materials, files and their blobs, plans, réserves, interventions,
 *     subcontractors, interims, workers);
 *   - a company: its own rubrique `clients`, its contacts (`clients.contacts`),
 *     its chantiers (`projects`) and every project section.
 * Trashing, reversible, needs none of this. The server action remains the
 * authority; this only decides what the page offers.
 */
export async function canPermanentlyDeleteProject(): Promise<boolean> {
  return (await canAccessArea("projects")) && (await canAccessEverySection());
}

export async function canPermanentlyDeleteClient(): Promise<boolean> {
  return (
    (await canAccessArea("clients")) &&
    (await canAccessArea("projects")) &&
    (await canAccessArea("clients.contacts")) &&
    (await canAccessEverySection())
  );
}
