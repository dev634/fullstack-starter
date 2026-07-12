import AddClientForm from "@/forms/AddClientForm";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function AddClientPage(){
    const session = await auth();
    if (session?.user?.role !== "ADMIN") {
        redirect("/clients");
    }
    const t = getDictionary(await getLocale());

    return (
        <main className="flex flex-1 min-h-0 flex-col justify-start overflow-y-auto py-8">
            <div className="w-full max-w-2xl mx-auto space-y-4 px-6">
                <h1 className="text-3xl font-bold mb-6">{t.clients.addTitle}</h1>
                <AddClientForm />
            </div>
        </main>
    );
}
