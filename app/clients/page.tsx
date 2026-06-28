import Button from "@/components/Button";
import Title from "@/components/Title";
import { findAll } from "@/repository/clients";
import Image from "next/image";
import Link from "next/link";

export default async function ClientsPage() {
  const clients = await findAll({ firstName: "asc" });
  return (
      <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
        <div className="w-full max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-4">
            <Title title="Clients" />
            <Button
              text="Add Client"
              as="link"
              href="/clients/add"
              classes="inline-block whitespace-nowrap px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-center no-underline"
            />
          </div>
          {clients.length ?
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((client) => {
              const initials =
                `${client.firstName?.[0] ?? ""}${client.lastName?.[0] ?? ""}`.toUpperCase() || "?";
              return (
                <li key={client.id}>
                  <Link
                    href={`/clients/${client.id}`}
                    className="flex h-full items-center gap-4 rounded-lg border border-gray-700 bg-gray-800 p-4 text-gray-100 transition-colors hover:bg-gray-700"
                  >
                    {client.photoUrl ? (
                      <Image
                        src={client.photoUrl}
                        alt={`${client.firstName} ${client.lastName}`}
                        width={48}
                        height={48}
                        className="h-12 w-12 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-500/20 font-semibold text-blue-300">
                        {initials}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {client.firstName}{client.lastName ? ` ${client.lastName}` : ""}
                      </span>
                      <span className="block truncate text-sm text-gray-400">{client.companyName}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          :
          <div className="h-[50vh] flex flex-col justify-center items-center">
            <p className="text-gray-400">No clients found.</p>
          </div>
          }
        </div>
      </main>
  );
}
