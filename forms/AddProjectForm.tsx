'use client'
import { addProject } from "@/actions/projects/projects";
import { useEffect, useActionState, useState } from 'react';
import { ProjectFields, type ProjectFormValues } from "@/forms/ProjectFields";
import { Toast } from "@/components/Toast";
import { useRouter } from "next/navigation";
import type { ProjectActionState } from "@/types/project";

const initialState: ProjectActionState = {
  type: null,
  message: "",
}

export default function AddProjectForm({ clientId }: { clientId: number }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<ProjectActionState, FormData>(
    addProject,
    initialState
  );
  const [values, setValues] = useState<ProjectFormValues>({
    name: "",
    type: "AUTRE",
    status: "ETUDE",
    power: "",
    budget: "",
    address: "",
    startDate: "",
    endDate: "",
    notes: "",
  });

  useEffect(() => {
    if (state.type !== "success") return;
    const timer = setTimeout(() => {
      router.push(`/clients/${clientId}`);
    }, 1500);
    return () => clearTimeout(timer);
  }, [state, router, clientId]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setValues(prev => ({ ...prev, [name]: value }));
  }

  return (
    <form action={formAction} className="w-full bg-transparent rounded shadow">
      <Toast type={state.type} message={state.message} />
      <input type="hidden" name="clientId" value={clientId} />
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
        Ajouter le projet
      </button>
    </form>
  );
}
