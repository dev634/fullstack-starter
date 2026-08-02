import { TOP_LEVEL_APP_AREAS, APP_AREA_CHILDREN, isAreaEffectivelyVisible, type AppAreaKey } from "@/lib/appAreas";
import { PROJECT_SECTION_KEYS, type ProjectSectionKey } from "@/lib/projectSections";

/**
 * Presentational checkbox tree for a job function's app-area access —
 * dashboard / clients / projects / admin, each expanded into its sub-parts.
 * The project's 7 detail sections are nested visually under "Projets" to
 * match the mockup, even though they're a separate storage axis
 * (hiddenSections, not hiddenAreas) — see JobFunctionsManager for the split.
 *
 * Unchecking a parent disables (but doesn't reset) its children/sections: a
 * disabled child's own checkbox is left untouched, so re-checking the parent
 * instantly restores whatever it held. The STORED hiddenAreas list only ever
 * reflects each key's own checkbox (JobFunctionsManager's saveConfig) — the
 * shared isAreaEffectivelyVisible (lib/appAreas.ts) used below is purely to
 * grey out/disable descendants here, never to decide what gets persisted.
 */

type AreaAccessTreeProps = {
  areaLabels: Record<AppAreaKey, string>;
  visibleAreas: ReadonlySet<AppAreaKey>;
  onToggleArea: (key: AppAreaKey) => void;
  sectionLabels: Record<ProjectSectionKey, string>;
  sectionsCaption: string;
  visibleSections: ReadonlySet<ProjectSectionKey>;
  onToggleSection: (key: ProjectSectionKey) => void;
};

const rowLabelClass = (enabled: boolean) =>
  `flex items-center gap-2 rounded px-2 py-1 text-sm ${
    enabled ? "cursor-pointer hover:bg-gray-500/10" : "cursor-not-allowed text-gray-400 dark:text-gray-600"
  }`;

export default function AreaAccessTree({
  areaLabels,
  visibleAreas,
  onToggleArea,
  sectionLabels,
  sectionsCaption,
  visibleSections,
  onToggleSection,
}: AreaAccessTreeProps) {
  return (
    <ul className="flex flex-col gap-1.5">
      {TOP_LEVEL_APP_AREAS.map((areaKey) => {
        const children = APP_AREA_CHILDREN[areaKey];
        const areaChecked = visibleAreas.has(areaKey);
        const showSections = areaKey === "projects";
        return (
          <li key={areaKey} className="overflow-hidden rounded border border-gray-200 dark:border-gray-700">
            <label className="flex cursor-pointer items-center gap-2 bg-gray-500/5 px-2 py-1.5 text-sm font-medium hover:bg-gray-500/10">
              <input
                type="checkbox"
                checked={areaChecked}
                onChange={() => onToggleArea(areaKey)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              <span>{areaLabels[areaKey]}</span>
            </label>
            {(children.length > 0 || showSections) && (
              <ul className="flex flex-col gap-0.5 py-1.5 pl-7 pr-2">
                {children.map((childKey) => {
                  // A child is only enabled if its parent is itself
                  // effectively visible (own checkbox + all of the parent's
                  // own ancestors) — for this parent (`areaKey`), which has
                  // no ancestors of its own, that reduces to "the parent's
                  // checkbox is on", same as before this was shared.
                  const childEnabled = isAreaEffectivelyVisible(areaKey, visibleAreas);
                  return (
                    <li key={childKey}>
                      <label className={rowLabelClass(childEnabled)}>
                        <input
                          type="checkbox"
                          checked={visibleAreas.has(childKey)}
                          disabled={!childEnabled}
                          onChange={() => onToggleArea(childKey)}
                          className="h-4 w-4 accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <span>{areaLabels[childKey]}</span>
                      </label>
                    </li>
                  );
                })}
                {showSections && (
                  <li className="mt-1 border-t border-dashed border-gray-200 pt-1.5 dark:border-gray-700">
                    <p
                      className={`px-2 pb-1 text-xs font-medium uppercase tracking-wide ${
                        areaChecked ? "text-gray-500 dark:text-gray-400" : "text-gray-400 dark:text-gray-600"
                      }`}
                    >
                      {sectionsCaption}
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {PROJECT_SECTION_KEYS.map((sectionKey) => (
                        <li key={sectionKey}>
                          <label className={rowLabelClass(areaChecked)}>
                            <input
                              type="checkbox"
                              checked={visibleSections.has(sectionKey)}
                              disabled={!areaChecked}
                              onChange={() => onToggleSection(sectionKey)}
                              className="h-4 w-4 accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <span>{sectionLabels[sectionKey]}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
