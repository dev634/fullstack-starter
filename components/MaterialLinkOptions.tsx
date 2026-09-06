import type { MaterialLinkOption } from "@/forms/AddMaterialForm";
import type { Dictionary } from "@/lib/i18n/dictionaries/types";

/**
 * Les options du selecteur « Tache liee », groupees par famille.
 *
 * Rendues a plat, les trois familles etaient indistinguables : une tache, une
 * serie et un groupe s'affichaient pareil, et l'on ne savait pas a quoi on
 * rattachait. Les <optgroup> sont la façon native de le dire, et ils sont lus
 * par les lecteurs d'ecran — contrairement a un prefixe textuel.
 *
 * Vocabulaire : ce que le code nomme `group` s'affiche « serie », et ce qu'il
 * nomme `category` s'affiche « groupe ». Les libelles ci-dessous suivent
 * l'interface, pas le schema.
 *
 * Partage par AddMaterialForm et EditMaterialForm : la valeur emise
 * (`task:12`) est reparsee cote serveur, donc deux copies qui divergeraient
 * produiraient un rattachement faux plutot qu'un simple ecart visuel.
 */
export default function MaterialLinkOptions({
  options,
  t,
}: {
  options: MaterialLinkOption[];
  t: Dictionary;
}) {
  const tasks = options.filter((o) => o.kind === "task");
  const series = options.filter((o) => o.kind === "group");
  const categories = options.filter((o) => o.kind === "category");

  return (
    <>
      {tasks.length > 0 && (
        <optgroup label={t.materials.linkedTaskTasksGroup}>
          {tasks.map((option) => (
            <option key={`task-${option.id}`} value={`task:${option.id}`}>
              {option.title}
            </option>
          ))}
        </optgroup>
      )}
      {series.length > 0 && (
        <optgroup label={t.materials.linkedTaskSeriesGroup}>
          {series.map((option) => (
            <option key={`group-${option.id}`} value={`group:${option.id}`}>
              {option.name}
            </option>
          ))}
        </optgroup>
      )}
      {categories.length > 0 && (
        <optgroup label={t.materials.linkedTaskCategoriesGroup}>
          {categories.map((option) => (
            <option key={`category-${option.id}`} value={`category:${option.id}`}>
              {option.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}
