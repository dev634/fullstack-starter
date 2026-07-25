import { getClient } from "@/actions/clients/clients";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import Title from "@/components/Title";
import AddProjectForm from "@/forms/AddProjectForm";
import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";

type PageProps = {
    params: Promise<{
        id: string;
    }>;
};

export default async function AddProjectPage({ params }: PageProps) {
    const session = await auth();
    if (!(await can(session?.user?.role, "content.edit"))) {
        redirect("/clients");
    }

    const { id } = await params;
    const clientId = parseInt(id, 10);
    const client = await getClient(clientId);
    const isError = client.type === "error";
    const isEmpty = client.type === "success" && !client.data;
    const t = getDictionary(await getLocale());

    if (isError) {
        return <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
                    <Title title={t.projects.addTitle} />
                    <p className="text-red-500">{client.message}</p>
               </main>
    }

    if (isEmpty) {
        return <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
                    <Title title={t.projects.addTitle} />
                    <p>{t.clients.detail.notFound}</p>
               </main>
    }

    return (
        <main className="flex flex-1 min-h-0 flex-col justify-start overflow-y-auto py-8">
            <div className="w-full max-w-2xl mx-auto space-y-4 px-6">
                <h1 className="text-3xl font-bold mb-2">{t.projects.addTitle}</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    {format(t.projects.addFor, { name: client.data!.companyName })}
                </p>
                <AddProjectForm clientId={clientId} />
            </div>
        </main>
    );
}
