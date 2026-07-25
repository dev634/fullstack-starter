import { findAll } from "@/repository/jobFunctions";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import JobFunctionsManager from "./_components/JobFunctionsManager";

// Fonctions tab of the Administration area. ADMIN+ via the area layout.
export default async function AdminFonctionsPage() {
  const functions = await findAll();
  const t = getDictionary(await getLocale());

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t.jobFunctions.subtitle}</p>
      <JobFunctionsManager functions={functions} />
    </div>
  );
}
