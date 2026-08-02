import { getClient } from '@/actions/clients/clients';
import { getAccessContext, projectIdFilter } from "@/lib/accessContext";
import { auth } from '@/lib/auth';
import { can } from "@/lib/access";
import { blockClientFromApp } from "@/lib/portal";
import { canAccessArea, requireAreaOrRedirect } from "@/lib/areaAccess";
import { findByClient } from '@/repository/projects';
import { findByClient as findContactsByClient } from '@/repository/contacts';
import { findAllOptions as findJobFunctions } from '@/repository/jobFunctions';
import ContactRow from '@/components/ContactRow';
import CollapsibleSection from '@/components/CollapsibleSection';
import AddContactForm from '@/forms/AddContactForm';
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
  UsersIcon,
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
  await blockClientFromApp();

  // The whole "clients" rubrique (this detail page's parent) can be hidden by
  // the caller's job function — treat it exactly like the list page: bounce
  // to the first rubrique they can actually reach.
  await requireAreaOrRedirect("clients");

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
  const canEdit = (await can(session?.user?.role, "content.edit"));

  // Sub-parts of this page, individually hideable by the caller's job
  // function (see lib/appAreas.ts). Data is only fetched for a block that
  // will actually render — both for the query cost and so a hidden block
  // never even has its data in the response.
  const showInfo = await canAccessArea("clients.info");
  const showContacts = await canAccessArea("clients.contacts");
  const showProjects = await canAccessArea("clients.projects");

  // Contacts' own "link to project" picker needs the project list even when
  // the Projects block itself is hidden — that's a different rubrique from
  // this feature, so its data dependency is OR'd rather than tied to it.
  const projects = (showProjects || showContacts)
    ? await findByClient(clientId, projectIdFilter(await getAccessContext()))
    : [];
  const contacts = showContacts ? await findContactsByClient(clientId) : [];
  // Managed job functions offered in the contact add/edit dropdowns.
  const jobFunctions = showContacts && canEdit ? await findJobFunctions() : [];

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
      <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
      <div className="overflow-hidden rounded-xl">

        {/* Header */}
        <div className="flex items-center gap-4 border-b border-gray-300 dark:border-gray-700 px-4 py-5 sm:px-6">
          <ClientAvatar
            photoUrl={data.photoUrl}
            name={data.companyName}
            size={56}
            className="text-lg"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BuildingOffice2Icon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
              <h1 className="truncate text-xl font-semibold">{data.companyName}</h1>
              <StatusBadge status={data.status} />
            </div>
          </div>
        </div>

        {/* Details (Coordonnées) — hideable via lib/appAreas.ts's "clients.info" */}
        {showInfo && (
          <dl className="px-4 py-2 sm:px-6">
            <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
              <EnvelopeIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
              <dt className="w-20 shrink-0 text-sm text-gray-500 dark:text-gray-400 sm:w-24">{t.clients.fields.email}</dt>
              <dd className="min-w-0 break-all text-sm text-primary">{data.email || "—"}</dd>
            </div>
            {data.phone && (
              <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
                <PhoneIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                <dt className="w-20 shrink-0 text-sm text-gray-500 dark:text-gray-400 sm:w-24">{t.clients.fields.phone}</dt>
                <dd className="min-w-0 break-all text-sm">{data.phone}</dd>
              </div>
            )}
            {websiteHref && (
              <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
                <LinkIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                <dt className="w-20 shrink-0 text-sm text-gray-500 dark:text-gray-400 sm:w-24">{t.clients.fields.website}</dt>
                <dd className="min-w-0 break-all text-sm">
                  <a href={websiteHref} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {data.website}
                  </a>
                </dd>
              </div>
            )}
            <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
              <MapPinIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
              <dt className="w-20 shrink-0 text-sm text-gray-500 dark:text-gray-400 sm:w-24">{t.clients.fields.address}</dt>
              <dd className="min-w-0 break-words text-sm">{data.address || "—"}</dd>
            </div>
            <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-700 py-3 last:border-b-0">
              <GlobeAltIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
              <dt className="w-20 shrink-0 text-sm text-gray-500 dark:text-gray-400 sm:w-24">{t.clients.detail.locality}</dt>
              <dd className="min-w-0 break-words text-sm">{locality || "—"}</dd>
            </div>
          </dl>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-gray-300 dark:border-gray-700 bg-gray-200 dark:bg-gray-900 px-4 py-4 sm:px-6">
          {canEdit && (
            <Link
              href={`/clients/${id}/edit`}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-sm font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 sm:flex-none"
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
      </div>

      {/* Contacts — hideable via lib/appAreas.ts's "clients.contacts" */}
      {showContacts && (
      <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
      <div className="overflow-hidden rounded-xl">
        <CollapsibleSection
          icon={<UsersIcon className="h-5 w-5 text-teal-500" />}
          title={t.contacts.heading}
          badge={contacts.length > 0 ? `(${contacts.length})` : undefined}
          headerExtra={canEdit && <AddContactForm clientId={clientId} functions={jobFunctions} />}
        >
        {contacts.length ? (
          <ul className="divide-y divide-gray-300 dark:divide-gray-700">
            {contacts.map((contact) => (
              <ContactRow key={contact.id} contact={contact} clientId={clientId} canEdit={canEdit} functions={jobFunctions} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
            {t.contacts.noContacts}
          </div>
        )}
        </CollapsibleSection>
      </div>
      </div>
      )}

      {/* Projects — hideable via lib/appAreas.ts's "clients.projects" */}
      {showProjects && (
      <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm transition-all hover:bg-[#d1d5dc] hover:shadow-lg hover:ring-2 hover:ring-blue-300 dark:hover:bg-[#374151] dark:hover:ring-blue-600">
      <div className="overflow-hidden rounded-xl">
        <CollapsibleSection
          icon={<BoltIcon className="h-5 w-5 text-amber-500" />}
          title={t.clients.detail.projectsHeading}
          badge={projects.length > 0 ? `(${projects.length})` : undefined}
          headerExtra={
            canEdit && (
              <Link
                href={`/clients/${id}/projects/add`}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary/90"
              >
                <PlusIcon className="h-4 w-4" />
                {t.clients.detail.addProject}
              </Link>
            )
          }
        >
        {projects.length ? (
          <ul className="divide-y divide-gray-300 dark:divide-gray-700">
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
                      className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600"
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
        </CollapsibleSection>
      </div>
      </div>
      )}

      </div>
    </main>
  )
}
