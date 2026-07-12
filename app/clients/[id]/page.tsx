import { getClient } from '@/actions/clients/clients';
import { auth } from '@/lib/auth';
import { findByClient } from '@/repository/projects';
import Title from '@/components/Title';
import ClientAvatar from '@/components/ClientAvatar';
import StatusBadge from '@/components/StatusBadge';
import ProjectStatusBadge from '@/components/ProjectStatusBadge';
import ProjectTypeBadge from '@/components/ProjectTypeBadge';
import Link from 'next/link';
import {
  EnvelopeIcon,
  MapPinIcon,
  GlobeAltIcon,
  BuildingOffice2Icon,
  PhoneIcon,
  LinkIcon,
  PencilSquareIcon,
  ArrowLeftIcon,
  BoltIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import DeleteClientButton from './_components/DeleteClientButton';
import DeleteProjectButton from './_components/DeleteProjectButton';
import { getLocale } from '@/lib/i18n/getLocale';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { localeTag } from '@/lib/i18n/formatDate';

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
  const locale = await getLocale();
  const t = getDictionary(locale);

  if(isError){
    return (
    <main className="flex flex-1 min-h-0 flex-col justify-start items-center overflow-y-auto py-8">
      <Title title={t.clients.detail.title} />
      <p className="text-red-500">{client.message}</p>
    </main>
    )
  }

  if(isEmpty){
    return <main className="flex flex-1 min-h-0 flex-col justify-start items-center overflow-y-auto py-8">
            <Title title={t.clients.detail.title} />
            <p>{t.clients.detail.notFound}</p>
          </main>
  }

  const data = client.data!;
  const locality = [data.city, data.zipCode, data.country].filter(Boolean).join(", ");
  const websiteHref = data.website
    ? (data.website.startsWith("http") ? data.website : `https://${data.website}`)
    : null;
  const session = await auth();
  const canEdit = session?.user?.role === "ADMIN";
  const projects = await findByClient(clientId);

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm">

        {/* Header */}
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 px-4 py-5 sm:px-6">
          <ClientAvatar
            photoUrl={data.photoUrl}
            firstName={data.firstName}
            lastName={data.lastName}
            size={56}
            className="text-lg"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold">{data.firstName} {data.lastName}</h1>
              <StatusBadge status={data.status} />
            </div>
            {data.companyName && (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                <BuildingOffice2Icon className="h-4 w-4" />
                <span className="truncate">{data.companyName}</span>
              </p>
            )}
          </div>
        </div>

        {/* Details */}
        <dl className="px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 py-3 last:border-b-0">
            <EnvelopeIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
            <dt className="w-20 shrink-0 text-sm text-gray-500 dark:text-gray-400 sm:w-24">{t.clients.fields.email}</dt>
            <dd className="min-w-0 break-all text-sm text-blue-600 dark:text-blue-400">{data.email || "—"}</dd>
          </div>
          {data.phone && (
            <div className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 py-3 last:border-b-0">
              <PhoneIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
              <dt className="w-20 shrink-0 text-sm text-gray-500 dark:text-gray-400 sm:w-24">{t.clients.fields.phone}</dt>
              <dd className="min-w-0 break-all text-sm">{data.phone}</dd>
            </div>
          )}
          {websiteHref && (
            <div className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 py-3 last:border-b-0">
              <LinkIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
              <dt className="w-20 shrink-0 text-sm text-gray-500 dark:text-gray-400 sm:w-24">{t.clients.fields.website}</dt>
              <dd className="min-w-0 break-all text-sm">
                <a href={websiteHref} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                  {data.website}
                </a>
              </dd>
            </div>
          )}
          <div className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 py-3 last:border-b-0">
            <MapPinIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
            <dt className="w-20 shrink-0 text-sm text-gray-500 dark:text-gray-400 sm:w-24">{t.clients.fields.address}</dt>
            <dd className="min-w-0 break-words text-sm">{data.address || "—"}</dd>
          </div>
          <div className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 py-3 last:border-b-0">
            <GlobeAltIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
            <dt className="w-20 shrink-0 text-sm text-gray-500 dark:text-gray-400 sm:w-24">{t.clients.detail.locality}</dt>
            <dd className="min-w-0 break-words text-sm">{locality || "—"}</dd>
          </div>
        </dl>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-4 sm:px-6">
          {canEdit && (
            <Link
              href={`/clients/${id}/edit`}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 sm:flex-none"
            >
              <PencilSquareIcon className="h-4 w-4" />
              {t.common.edit}
            </Link>
          )}
          {canEdit && <DeleteClientButton clientId={data.id} />}
          <Link
            href="/clients"
            className="inline-flex w-full items-center justify-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 sm:ml-auto sm:w-auto"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.common.back}
          </Link>
        </div>

      </div>

      {/* Projects */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-700 px-4 py-4 sm:px-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <BoltIcon className="h-5 w-5 text-amber-500" />
            {t.clients.detail.projectsHeading}
          </h2>
          {canEdit && (
            <Link
              href={`/clients/${id}/projects/add`}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600"
            >
              <PlusIcon className="h-4 w-4" />
              {t.clients.detail.addProject}
            </Link>
          )}
        </div>

        {projects.length ? (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {projects.map((project) => (
              <li key={project.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <Link href={`/clients/${id}/projects/${project.id}`} className="min-w-0 flex-1 hover:opacity-80">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{project.name}</span>
                    <ProjectTypeBadge type={project.type} />
                    <ProjectStatusBadge status={project.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {project.power != null && <span>{project.power} kWc</span>}
                    {project.budget != null && (
                      <span>{project.budget.toLocaleString(localeTag(locale))} €</span>
                    )}
                    {project.startDate && (
                      <span>{t.projects.list.startPrefix}{new Date(project.startDate).toLocaleDateString(localeTag(locale))}</span>
                    )}
                  </div>
                </Link>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/clients/${id}/projects/${project.id}/edit`}
                      className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      <PencilSquareIcon className="h-3.5 w-3.5" />
                      {t.common.edit}
                    </Link>
                    <DeleteProjectButton projectId={project.id} clientId={clientId} projectName={project.name} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
            {t.clients.detail.noProjects}
          </div>
        )}
      </div>

      </div>
    </main>
  )
}
