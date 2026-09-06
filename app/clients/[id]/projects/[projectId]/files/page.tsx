import { findChildren as findChildFolders, getBreadcrumb } from "@/repository/projectFolders";
import { findByFolder as findFilesByFolder } from "@/repository/projectFiles";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import { resolveProjectSectionAccess } from "@/lib/projectSectionGuard";
import { parseFolderIdParam } from "@/lib/folderIdParam";
import { blockClientFromApp } from "@/lib/portal";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import Title from "@/components/Title";
import ProjectFolderRow from "@/components/ProjectFolderRow";
import ProjectFileRow from "@/components/ProjectFileRow";
import CreateFolderForm from "@/forms/CreateFolderForm";
import UploadFileForm from "@/forms/UploadFileForm";
import Link from "next/link";
import { ArrowLeftIcon, FolderIcon, HomeIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

type PageProps = {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
  searchParams: Promise<{
    /** Next can hand back an array on a repeated `?folder=1&folder=2` —
     * parseFolderIdParam (lib/folderIdParam.ts) is what actually narrows
     * this down to a single, bounded id. */
    folder?: string | string[];
  }>;
};

export default async function ProjectFilesPage({ params, searchParams }: PageProps) {
  await blockClientFromApp();
  const { id, projectId } = await params;
  const locale = await getLocale();
  const t = getDictionary(locale);

  const access = await resolveProjectSectionAccess({ id, projectId }, "files");

  if (!access.ok) {
    return (
      <main className="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
        <Title title={t.projects.detail.filesHeading} />
        <p className={access.reason === "error" ? "text-red-500" : undefined}>
          {access.reason === "forbidden"
            ? t.errors.forbidden
            : access.reason === "error"
              ? access.message
              : t.projects.detail.notFound}
        </p>
        {/* This page is now its own destination — a refusal must still offer
            a one-gesture way back, the same link the success path below
            uses, rather than leaving only the browser's own back button. */}
        <Link
          href={`/clients/${id}/projects/${projectId}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {t.projectDashboard.backToProject}
        </Link>
      </main>
    );
  }

  const { clientId, projectId: pid, project } = access;
  const session = await auth();
  const canEdit = await can(session?.user?.role, "content.edit");

  const { folder: folderParam } = await searchParams;
  const currentFolderId = parseFolderIdParam(folderParam);

  const [subfolders, files, breadcrumb] = await Promise.all([
    findChildFolders(pid, currentFolderId),
    findFilesByFolder(pid, currentFolderId),
    getBreadcrumb(pid, currentFolderId),
  ]);

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t.projects.detail.filesHeading} · {project.name}
          </h1>
          <Link
            href={`/clients/${id}/projects/${pid}`}
            className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t.projectDashboard.backToProject}
          </Link>
        </div>

        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] text-gray-900 dark:text-gray-100 shadow-sm">
          <div className="overflow-hidden rounded-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
              <h2 className="flex min-w-[8rem] flex-1 items-center gap-2 text-lg font-semibold">
                <FolderIcon className="h-5 w-5 shrink-0 text-amber-500" />
                <span className="truncate">{t.projects.detail.filesHeading}</span>
              </h2>
              {canEdit && <CreateFolderForm clientId={clientId} projectId={pid} parentId={currentFolderId} />}
            </div>

            {/* Breadcrumb */}
            <div className="flex flex-wrap items-center gap-1 border-b border-gray-300 dark:border-gray-700 px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 sm:px-6">
              <Link
                href={`/clients/${id}/projects/${pid}/files`}
                className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200"
                aria-label={t.files.home}
              >
                <HomeIcon className="h-4 w-4" />
              </Link>
              {breadcrumb.map((crumb) => (
                <span key={crumb.id} className="flex items-center gap-1">
                  <ChevronRightIcon className="h-3.5 w-3.5" />
                  <Link
                    href={`/clients/${id}/projects/${pid}/files?folder=${crumb.id}`}
                    className="truncate hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    {crumb.name}
                  </Link>
                </span>
              ))}
            </div>

            {subfolders.length || files.length ? (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {subfolders.map((folder) => (
                  <ProjectFolderRow key={`folder-${folder.id}`} folder={folder} clientId={clientId} projectId={pid} canEdit={canEdit} />
                ))}
                {files.map((file) => (
                  <ProjectFileRow key={`file-${file.id}`} file={file} clientId={clientId} projectId={pid} canEdit={canEdit} />
                ))}
              </ul>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
                {t.projects.detail.emptyFolder}
              </div>
            )}

            {canEdit && (
              <div className="border-t border-gray-300 dark:border-gray-700">
                <UploadFileForm clientId={clientId} projectId={pid} folderId={currentFolderId} />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
