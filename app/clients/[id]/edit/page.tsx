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
        return <main className="flex flex-col justify-center items-center h-dvh overflow-y-auto pb-8">
                    <Title title="Edit page"/>
                    <p className="text-red-500">{client.message}</p>
               </main>
    }

    if(isEmpty){
        return <main className="flex flex-col justify-center items-center h-dvh overflow-y-auto pb-8">
                    <Title title="Edit page"/>
                    <p>This client does not exist ...</p>
               </main>
    }

    return <main className="flex flex-col justify-center items-center h-dvh overflow-y-auto pb-8">
                <Title title="Edit page"/>
                <UpdateClientForm client={client.data!} />
           </main>
}
