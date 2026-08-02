import { getClient } from "@/actions/clients/clients";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import Title from "@/components/Title";
import UpdateClientForm from "@/forms/UpdateClientForm";
import { redirect } from "next/navigation";
import { requireAreaOrRedirect } from "@/lib/areaAccess";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

type PageProps = {
    params: Promise<{
        id: string;
    }>;
};

export default async function EditPage({ params }: PageProps){
    const session = await auth();
    if (!(await can(session?.user?.role, "content.edit"))) {
        redirect("/clients");
    }

    // The whole "clients" rubrique can be hidden by the caller's job function —
    // bounce to the first rubrique they can actually reach, same as the list
    // and detail pages.
    await requireAreaOrRedirect("clients");

    const { id } = await params;
    const clientId = parseInt(id, 10);
    const client = await getClient(clientId);
    const isError = client.type === "error";
    const isEmpty = client.type === "success" && !client.data;
    const t = getDictionary(await getLocale());

    if(isError){
        return <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
                    <Title title={t.clients.editTitle}/>
                    <p className="text-red-500">{client.message}</p>
               </main>
    }

    if(isEmpty){
        return <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
                    <Title title={t.clients.editTitle}/>
                    <p>{t.clients.detail.notFound}</p>
               </main>
    }

    return <main className="flex flex-1 min-h-0 flex-col justify-start items-center overflow-y-auto px-6 py-8">
                <div className="w-full max-w-2xl">
                    <Title title={t.clients.editTitle}/>
                    <UpdateClientForm client={client.data!} />
                </div>
           </main>
}
