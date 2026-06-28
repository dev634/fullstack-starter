import { getClient } from "@/actions/clients/clients";
import Title from "@/components/Title";
import UpdateClientForm from "@/forms/UpdateClientForm";

type PageProps = {
    params: Promise<{
        id: string;
    }>;
};

export default async function EditPage({ params }: PageProps){
    const { id } = await params;
    const clientId = parseInt(id, 10);
    const client = await getClient(clientId);
    const isError = client.type === "error";
    const isEmpty = client.type === "success" && !client.data;

    if(isError){
        return <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
                    <Title title="Edit page"/>
                    <p className="text-red-500">{client.message}</p>
               </main>
    }

    if(isEmpty){
        return <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
                    <Title title="Edit page"/>
                    <p>This client does not exist ...</p>
               </main>
    }

    return <main className="flex flex-1 min-h-0 flex-col justify-start items-center overflow-y-auto px-6 py-8">
                <div className="w-full max-w-md">
                    <Title title="Edit page"/>
                    <UpdateClientForm client={client.data!} />
                </div>
           </main>
}
