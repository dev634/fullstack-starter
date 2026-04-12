import Button from "@/components/Button,";
import Title from "@/components/Title";
import Link from "next/link";

export default function ClientsPage() {
  return (
      <main className="flex justify-center min-h-screen py-8">
        <div className="container w-8/12 space-y-4 py-8">
          <Title title="Clients" />
          <ul className="mb-8 space-y-6">
            {[{ id: 1, name: "Client 1" }, { id: 2, name: "Client 2" }, { id: 3, name: "Client 3" }].map((client) => (
                <li key={client.id} className="flex border rounded cursor-pointer hover:bg-gray-100 hover:text-gray-700">
                  <Link href={`/clients/${client.id}`} className="px-8 py-4 w-full text-lg font-semibold">
                    {client.name}
                  </Link>
                </li>
            ))}
          </ul>
          <Button text="Add Client" as="link" href="/clients/add" />
        </div>
      </main>

  );
}
