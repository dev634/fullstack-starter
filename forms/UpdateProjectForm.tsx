'use client'
import { updateProject } from "@/actions/projects/projects";
import { useEffect, useActionState, useState } from 'react';
import { ProjectFields, type ProjectFormValues } from "@/forms/ProjectFields";
import { Toast } from "@/components/Toast";
import { useRouter } from "next/navigation";
import type { ProjectActionState } from "@/types/project";
import type { Project } from "@/app/generated/prisma/client";

const initialState: ProjectActionState = {
  type: null,
  message: "",
}

function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

export default function UpdateProjectForm({ project }: { project: Project }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<ProjectActionState, FormData>(
    updateProject,
    initialState
  );
  const [values, setValues] = useState<ProjectFormValues>({
    name: project.name,
    type: project.type,
    status: project.status,
    power: project.power?.toString() ?? "",
    budget: project.budget?.toString() ?? "",
    address: project.address ?? "",
    startDate: toDateInputValue(project.startDate),
    endDate: toDateInputValue(project.endDate),
    notes: project.notes ?? "",
  });

  useEffect(() => {
    if (state.type !== "success") return;
    const timer = setTimeout(() => {
      router.push(`/clients/${project.clientId}`);
    }, 1500);
    return () => clearTimeout(timer);
  }, [state, router, project.clientId]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setValues(prev => ({ ...prev, [name]: value }));
  }

  return (
    <form action={formAction} className="w-full bg-transparent rounded shadow">
      <Toast type={state.type} message={state.message} />
      <input type="hidden" name="id" value={project.id} />
      <input type="hidden" name="clientId" value={project.clientId} />
      <ProjectFields
        values={values}
        onChange={handleChange}
        errors={state.type === "zodError" ? state.fieldsForm : undefined}
      />
      <button
        type="submit"
        disabled={isPending}
        className={`w-full px-4 py-2 bg-blue-500 text-white
        rounded hover:bg-blue-600 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        Modifier le projet
      </button>
    </form>
  );
}
