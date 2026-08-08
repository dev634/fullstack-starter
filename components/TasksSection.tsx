'use client'
import { useState, type ComponentProps } from "react";
import CollapsibleSection from "@/components/CollapsibleSection";
import AddTaskForm from "@/forms/AddTaskForm";
import GenerateTaskSeriesForm, { type TaskCategoryOption } from "@/forms/GenerateTaskSeriesForm";
import AddTaskCategoryForm from "@/forms/AddTaskCategoryForm";

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
  // reveals the section itself. Inner categories/groups keep their own
  // collapsed state — out of scope here.
  const [open, setOpen] = useState(false);

  return (
    <CollapsibleSection
      icon={icon}
      title={title}
      badge={badge}
      open={open}
      onOpenChange={setOpen}
      headerExtra={
        canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <AddTaskForm
              clientId={clientId}
              projectId={projectId}
              categories={categories}
              onCreated={() => setOpen(true)}
            />
            <GenerateTaskSeriesForm
              clientId={clientId}
              projectId={projectId}
              categories={categories}
              onCreated={() => setOpen(true)}
            />
            <AddTaskCategoryForm clientId={clientId} projectId={projectId} />
          </div>
        )
      }
    >
      {children}
    </CollapsibleSection>
  );
}
