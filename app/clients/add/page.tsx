import AddClientForm from "@/forms/AddClientForm";

export default function AddClientPage(){
    return (
        <main className="flex flex-1 min-h-0 flex-col justify-start overflow-y-auto py-8">
            <div className="w-full max-w-2xl mx-auto space-y-4 px-6">
                <h1 className="text-3xl font-bold mb-6">Add Client</h1>
                <AddClientForm />
            </div>
        </main>
    );
}