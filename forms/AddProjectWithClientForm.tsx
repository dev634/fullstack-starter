'use client'
import { addProject } from "@/actions/projects/projects";
import { useEffect, useActionState, useState } from 'react';
import { ProjectFields, type ProjectFormValues } from "@/forms/ProjectFields";
import { Toast } from "@/components/Toast";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/components/LocaleProvider";
import type { ProjectActionState } from "@/types/project";

const initialState: ProjectActionState = { type: null, message: "" };

// Add a project from the global /projects list — pick which existing company
// it belongs to, unlike AddProjectForm which is scoped to one company.
export default function AddProjectWithClientForm({
  clients,
}: {
  clients: { id: number; companyName: string }[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<ProjectActionState, FormData>(addProject, initialState);
  const [clientId, setClientId] = useState("");
  const [values, setValues] = useState<ProjectFormValues>({
    name: "",
    businessNumber: "",
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
      router.push("/projects");
    }, 1500);
    return () => clearTimeout(timer);
  }, [state, router]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <form action={formAction} className="w-full bg-transparent rounded shadow">
      <Toast type={state.type} message={state.message} />

      <div className="mb-7">
        <label htmlFor="clientId" className="mb-2 block text-sm text-gray-500 dark:text-gray-400">
          {t.projects.clientLabel}
        </label>
        <select
          id="clientId"
          name="clientId"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          required
          className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-gray-900 dark:text-gray-100"
        >
          <option value="">{t.projects.clientPlaceholder}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.companyName}</option>
          ))}
        </select>
        {state.type === "zodError" && state.fieldsForm?.clientId && (
          <p className="mt-1 text-xs text-red-500">{state.fieldsForm.clientId}</p>
        )}
      </div>

      <ProjectFields
        values={values}
        onChange={handleChange}
        errors={state.type === "zodError" ? state.fieldsForm : undefined}
      />
      <button
        type="submit"
        disabled={isPending || !clientId}
        className={`w-full px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 cursor-pointer ${
          isPending || !clientId ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {t.projects.addSubmit}
      </button>
    </form>
  );
}
