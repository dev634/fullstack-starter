import AddClientForm from "@/forms/AddClientForm";

export default function AddClientPage(){
    return (
        <main className="flex flex-col justify-start h-dvh overflow-y-auto pb-8">
            <div className="mx-auto space-y-4 px-6">
                <h1 className="text-3xl font-bold mb-6">Add Client</h1>
                <AddClientForm />
            </div>
        </main>
    );
}