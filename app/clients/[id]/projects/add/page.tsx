import { getClient } from "@/actions/clients/clients";
import { auth } from "@/lib/auth";
import Title from "@/components/Title";
import AddProjectForm from "@/forms/AddProjectForm";
import { redirect } from "next/navigation";

type PageProps = {
    params: Promise<{
        id: string;
    }>;
};

export default async function AddProjectPage({ params }: PageProps) {
    const session = await auth();
    if (session?.user?.role !== "ADMIN") {
        redirect("/clients");
    }

    const { id } = await params;
    const clientId = parseInt(id, 10);
    const client = await getClient(clientId);
    const isError = client.type === "error";
    const isEmpty = client.type === "success" && !client.data;

    if (isError) {
        return <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
                    <Title title="Ajouter un projet" />
                    <p className="text-red-500">{client.message}</p>
               </main>
    }

    if (isEmpty) {
        return <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
                    <Title title="Ajouter un projet" />
                    <p>Ce client n&apos;existe pas...</p>
               </main>
    }

    return (
        <main className="flex flex-1 min-h-0 flex-col justify-start overflow-y-auto py-8">
            <div className="w-full max-w-2xl mx-auto space-y-4 px-6">
                <h1 className="text-3xl font-bold mb-2">Ajouter un projet</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    Pour {client.data!.firstName} {client.data!.lastName}
                </p>
                <AddProjectForm clientId={clientId} />
            </div>
        </main>
    );
}
