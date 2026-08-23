'use client'
import { updateProject } from "@/actions/projects/projects";
import { useEffect, useActionState, useState } from 'react';
import { ProjectFields, type ProjectFormValues } from "@/forms/ProjectFields";
import { Toast } from "@/components/Toast";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/components/LocaleProvider";
import type { ProjectActionState } from "@/types/project";
import type { Project } from "@/app/generated/prisma/client";

// Exactement les colonnes que ce formulaire lit — pas la ligne Project
// entiere, et surtout pas sa relation `client`. Le typage de TypeScript
// est structurel : passer une valeur plus large ne produit aucune erreur,
// et React serialise alors TOUT dans la charge RSC, donc dans le HTML.
// C est ainsi que l email, le telephone et l adresse de l entreprise
// partaient vers le navigateur sur une page gardee par la rubrique
// `projects` et non `clients` — lisibles par un compte a qui la rubrique
// `clients` a justement ete retiree.
// Un Pick ne suffit pas seul : c est le fait de construire un objet
// LITTERAL au site d appel qui declenche le controle des proprietes
// excedentaires. Les deux moities comptent.
type UpdateProjectFormProject = Pick<
  Project,
  | "id"
  | "clientId"
  | "name"
  | "businessNumber"
  | "type"
  | "status"
  | "power"
  | "budget"
  | "address"
  | "startDate"
  | "endDate"
  | "notes"
>;

const initialState: ProjectActionState = {
  type: null,
  message: "",
}

function toDateInputValue(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

export default function UpdateProjectForm({ project }: { project: UpdateProjectFormProject }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<ProjectActionState, FormData>(
    updateProject,
    initialState
  );
  const [values, setValues] = useState<ProjectFormValues>({
    name: project.name,
    businessNumber: project.businessNumber ?? "",
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
        className={`w-full px-4 py-2 bg-primary text-white
        rounded hover:bg-primary/90 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {t.projects.editSubmit}
      </button>
    </form>
  );
}
