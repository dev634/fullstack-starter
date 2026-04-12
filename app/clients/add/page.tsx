import AddClientForm from "@/forms/AddClientForm";

export default function AddClientPage(){
    return (
        <main className="flex flex-col justify-center min-h-screen py-8">
            <div className="w-8/12 mx-auto space-y-4">
                <h1 className="text-3xl font-bold mb-6">Add Client</h1>
                <AddClientForm />
            </div>
        </main>
    );
}