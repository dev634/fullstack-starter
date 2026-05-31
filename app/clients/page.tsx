import Button from "@/components/Button";
import Title from "@/components/Title";
import { findAll } from "@/repository/clients";
import { PencilIcon, TrashIcon } from "@heroicons/react/16/solid";
import Link from "next/link";

export default async function ClientsPage() {
  const clients = await findAll({ firstName: "asc" });
  return (
      <main className="flex justify-center px-6">
        <div className="container space-y-4">
          <Title title="Clients" />
          {clients.length ?
          <ul className="mb-8 space-y-6 overflow-y-scroll h-[60vh]">
            {clients.map((client) => (
                <li key={client.id} className="flex border rounded hover:bg-gray-100 hover:text-gray-700">
                  <Link href={`/clients/${client.id}`} className="px-5 py-4 w-full text-lg font-semibold cursor-pointer ">
                   <p>{client.firstName} {client.lastName ? ` ${client.lastName}` : ""}</p>
                   <p>{client.companyName}</p>
                  </Link>
                </li>
            ))}
          </ul>
          :
          <div className="mb-8 h-[60vh] flex flex-col justify-center items-center">
            <p className="text-gray-500">No clients found.</p>
          </div>
          }
          <Button text="Add Client" as="link" href="/clients/add" />
        </div>
      </main>
  );
}
