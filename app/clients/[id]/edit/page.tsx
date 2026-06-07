import Title from "@/components/Title";
import UpdateClientForm from "@/forms/UpdateClientForm";

export default function EditPage(){
    return <main className="flex flex-col justify-center items-center h-dvh overflow-y-auto pb-8">
                <Title title="Edit page"/>
                <UpdateClientForm />
           </main>
}