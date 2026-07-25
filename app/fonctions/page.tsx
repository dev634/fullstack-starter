import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { redirect } from "next/navigation";
import { findAll } from "@/repository/jobFunctions";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import JobFunctionsManager from "./_components/JobFunctionsManager";

// Manage the reusable list of job functions. Accessible to ADMIN and
// SUPERADMIN (unlike /admin/settings which is SUPERADMIN-only).
export default async function JobFunctionsPage() {
  const session = await auth();
  if (!hasMinRole(session?.user?.role, "ADMIN")) {
    redirect("/clients");
  }

  const functions = await findAll();
  const t = getDictionary(await getLocale());

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-2xl mx-auto space-y-4">
        <h1 className="text-3xl font-bold">{t.jobFunctions.title}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t.jobFunctions.subtitle}</p>
        <JobFunctionsManager functions={functions} />
      </div>
    </main>
  );
}
