'use client'
import { useState, type ComponentProps } from "react";
import CollapsibleSection from "@/components/CollapsibleSection";
import AddTaskForm from "@/forms/AddTaskForm";
import GenerateTaskSeriesForm, { type TaskCategoryOption } from "@/forms/GenerateTaskSeriesForm";
import AddTaskCategoryForm from "@/forms/AddTaskCategoryForm";
import { CategoryRevealProvider, type CategoryRevealSignal } from "@/components/TaskCategoryReveal";

type PassThrough = Pick<ComponentProps<typeof CollapsibleSection>, "icon" | "title" | "badge" | "children">;

export default function TasksSection({
  clientId,
  projectId,
  categories,
  canEdit,
  icon,
  title,
  badge,
  children,
}: PassThrough & {
  clientId: number;
  projectId: number;
  categories: TaskCategoryOption[];
  canEdit: boolean;
}) {
  // The Tasks section is collapsed by default; creating a task or a series
  // reveals the section itself. When the new task/series lands in a
  // category, that category is also revealed via CategoryRevealProvider —
  // the category rows are opaque children rendered by the server, so a
  // React context is the only way to signal them from here. Groups stay
  // collapsed: a series creates a group, and seeing the group row is enough.
  //
  // Not cleared after consumption on purpose: a category may mount *after*
  // the signal (RSC refresh, section opening) and reads it at mount. Relies
  // on the stable per-category keys in the project page.
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState<CategoryRevealSignal>(null);

  const handleCreated = (revealCategoryId: number | null) => {
    setOpen(true);
    if (revealCategoryId != null) setReveal({ categoryId: revealCategoryId });
  };

  return (
    <CollapsibleSection
      icon={icon}
      title={title}
      badge={badge}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Collapsing the section drops any pending reveal, so re-opening it
        // later doesn't re-expand a category from an old creation.
        if (!next) setReveal(null);
      }}
      headerExtra={
        canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <AddTaskForm
              clientId={clientId}
              projectId={projectId}
              categories={categories}
              onCreated={handleCreated}
            />
            <GenerateTaskSeriesForm
              clientId={clientId}
              projectId={projectId}
              categories={categories}
              onCreated={handleCreated}
            />
            <AddTaskCategoryForm clientId={clientId} projectId={projectId} />
          </div>
        )
      }
    >
      <CategoryRevealProvider value={reveal}>{children}</CategoryRevealProvider>
    </CollapsibleSection>
  );
}
