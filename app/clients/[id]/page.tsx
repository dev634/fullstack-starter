import { getClient } from '@/actions/clients/clients';
import Title from '@/components/Title';
import Image from 'next/image';
import Link from 'next/link';
import {
  EnvelopeIcon,
  MapPinIcon,
  GlobeAltIcon,
  BuildingOffice2Icon,
  PencilSquareIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline';
import DeleteClientButton from './_components/DeleteClientButton';

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ClientPage({ params }: PageProps) {
  const { id } = await params;
  const clientId = parseInt(id, 10);
  const client = await getClient(clientId);
  const isError = client.type === "error";
  const isEmpty = client.type === "success" && !client.data

  if(isError){
    return (
    <main className="flex flex-1 min-h-0 flex-col justify-start items-center overflow-y-auto py-8">
      <Title title="Client Detail" />
      <p className="text-red-500">{client.message}</p>
    </main>
    )
  }

  if(isEmpty){
    return <main className="flex flex-1 min-h-0 flex-col justify-start items-center overflow-y-auto py-8">
            <Title title="Client Detail" />
            <p>This client doesn&apos;t exist ...</p>
          </main>
  }

  const data = client.data!;
  const initials =
    `${data.firstName?.[0] ?? ""}${data.lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const locality = [data.city, data.zipCode, data.country].filter(Boolean).join(", ");

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-xl mx-auto overflow-hidden rounded-xl border border-gray-700 bg-gray-800 text-gray-100 shadow-sm">

        {/* Header */}
        <div className="flex items-center gap-4 border-b border-gray-700 px-4 py-5 sm:px-6">
          {data.photoUrl ? (
            <Image
              src={data.photoUrl}
              alt={`${data.firstName} ${data.lastName}`}
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-lg font-semibold text-blue-300">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{data.firstName} {data.lastName}</h1>
            {data.companyName && (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-400">
                <BuildingOffice2Icon className="h-4 w-4" />
                <span className="truncate">{data.companyName}</span>
              </p>
            )}
          </div>
        </div>

        {/* Details */}
        <dl className="px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3 border-b border-gray-700 py-3">
            <EnvelopeIcon className="h-5 w-5 shrink-0 text-gray-500" />
            <dt className="w-20 shrink-0 text-sm text-gray-400 sm:w-24">Email</dt>
            <dd className="min-w-0 break-all text-sm text-blue-400">{data.email || "—"}</dd>
          </div>
          <div className="flex items-center gap-3 border-b border-gray-700 py-3">
            <MapPinIcon className="h-5 w-5 shrink-0 text-gray-500" />
            <dt className="w-20 shrink-0 text-sm text-gray-400 sm:w-24">Adresse</dt>
            <dd className="min-w-0 break-words text-sm">{data.address || "—"}</dd>
          </div>
          <div className="flex items-center gap-3 py-3">
            <GlobeAltIcon className="h-5 w-5 shrink-0 text-gray-500" />
            <dt className="w-20 shrink-0 text-sm text-gray-400 sm:w-24">Localité</dt>
            <dd className="min-w-0 break-words text-sm">{locality || "—"}</dd>
          </div>
        </dl>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-gray-700 bg-gray-900 px-4 py-4 sm:px-6">
          <Link
            href={`/clients/${id}/edit`}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-gray-600 bg-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-600 sm:flex-none"
          >
            <PencilSquareIcon className="h-4 w-4" />
            Modifier
          </Link>
          <DeleteClientButton clientId={data.id} />
          <Link
            href="/clients"
            className="inline-flex w-full items-center justify-center gap-1 text-sm text-gray-400 hover:text-gray-200 sm:ml-auto sm:w-auto"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Retour
          </Link>
        </div>

      </div>
    </main>
  )
}
