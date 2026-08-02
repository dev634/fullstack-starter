import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import Title from "@/components/Title";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAreaOrRedirect } from "@/lib/areaAccess";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import ImportClientsForm from "./_components/ImportClientsForm";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function ImportClientsPage() {
  const session = await auth();
  if (!(await can(session?.user?.role, "content.import"))) {
    redirect("/clients");
  }

  // The whole "clients" rubrique can be hidden by the caller's job function —
  // bounce to the first rubrique they can actually reach, same as the list
  // and detail pages.
  await requireAreaOrRedirect("clients");

  const t = getDictionary(await getLocale());

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Title title={t.clients.import.title} />
          <Link
            href="/clients"
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.clients.import.back}
          </Link>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t.clients.import.introPrefix}{" "}
          <Link href="/clients/export" className="text-primary hover:underline">
            {t.clients.import.introLink}
          </Link>{" "}
          {t.clients.import.introSuffix}
        </p>

        <ImportClientsForm />
      </div>
    </main>
  );
}
