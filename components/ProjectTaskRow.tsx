'use client'
import { toggleTask, deleteTask } from "@/actions/tasks/tasks";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import type { ProjectTask } from "@/app/generated/prisma/client";

type ProjectTaskRowProps = {
  task: ProjectTask;
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectTaskRow({ task, clientId, projectId, canEdit }: ProjectTaskRowProps) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleToggle() {
    if (!canEdit || pending) return;
    setPending(true);
    await toggleTask(task.id, !task.done, clientId, projectId);
    setPending(false);
    router.refresh();
  }

  async function handleDelete() {
    if (pending) return;
    setPending(true);
    await deleteTask(task.id, clientId, projectId);
    setPending(false);
    router.refresh();
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
      <input
        type="checkbox"
        checked={task.done}
        disabled={!canEdit || pending}
        onChange={handleToggle}
        aria-label={`Marquer « ${task.title} » comme ${task.done ? "à faire" : "terminée"}`}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 dark:border-gray-600 disabled:cursor-not-allowed"
      />
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          task.done ? "text-gray-400 line-through dark:text-gray-500" : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {task.title}
      </span>
      {task.dueDate && (
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
          {new Date(task.dueDate).toLocaleDateString("fr-FR")}
        </span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          aria-label={`Supprimer la tâche ${task.title}`}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
