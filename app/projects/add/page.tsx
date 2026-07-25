import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { redirect } from "next/navigation";
import { findAll } from "@/repository/clients";
import AddProjectWithClientForm from "@/forms/AddProjectWithClientForm";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Add a project from the global projects list, linking it to an existing
// company. Content creation → EDITOR+.
export default async function AddProjectPage() {
  const session = await auth();
  if (!hasMinRole(session?.user?.role, "EDITOR")) {
    redirect("/projects");
  }

  const clients = await findAll({ companyName: "asc" });
  const t = getDictionary(await getLocale());

  return (
    <main className="flex flex-1 min-h-0 flex-col justify-start overflow-y-auto py-8">
      <div className="w-full max-w-2xl mx-auto space-y-4 px-6">
        <h1 className="mb-2 text-3xl font-bold">{t.projects.addTitle}</h1>
        <AddProjectWithClientForm clients={clients.map((c) => ({ id: c.id, companyName: c.companyName }))} />
      </div>
    </main>
  );
}
