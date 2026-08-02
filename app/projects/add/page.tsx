import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import { redirect } from "next/navigation";
import { requireAreaOrRedirect } from "@/lib/areaAccess";
import { findAll } from "@/repository/clients";
import AddProjectWithClientForm from "@/forms/AddProjectWithClientForm";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

// Add a project from the global projects list, linking it to an existing
// company. Content creation → EDITOR+.
export default async function AddProjectPage() {
  const session = await auth();
  if (!(await can(session?.user?.role, "content.edit"))) {
    redirect("/projects");
  }

  // The whole "projects" rubrique can be hidden by the caller's job function —
  // bounce to the first rubrique they can actually reach.
  await requireAreaOrRedirect("projects");

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
