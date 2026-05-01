import Button from "@/components/Button,";
import Title from "@/components/Title";
import { prisma } from "@/lib/prisma";

import Link from "next/link";

export default async function ClientsPage() {
  const clients = await prisma.client.findMany({
    orderBy: { companyName: "asc" },
  });

  return (
      <main className="flex justify-center px-6">
        <div className="container space-y-4">
          <Title title="Clients" />
          <ul className="mb-8 space-y-6 overflow-y-scroll h-[60vh]">
            {clients.map((client) => (
                <li key={client.id} className="flex border rounded cursor-pointer hover:bg-gray-100 hover:text-gray-700">
                  <Link href={`/clients/${client.id}`} className="px-8 py-4 w-full text-lg font-semibold">
                   <p>{client.firstName} {client.lastName ? ` ${client.lastName}` : ""}</p>
                   <p>{client.companyName}</p>
                  </Link>
                </li>
            ))}
          </ul>
          <Button text="Add Client" as="link" href="/clients/add" />
        </div>
      </main>

  );
}
