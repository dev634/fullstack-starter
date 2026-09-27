'use client'
import { detachWorker } from "@/actions/projectWorkers/projectWorkers";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { useRowAction } from "@/lib/useRowAction";
import type { ProjectWorkerRow as ProjectWorkerRowData } from "@/repository/projectWorkers";

// `import type` only — erased at compile time, so this never pulls
// repository/projectWorkers.ts's Prisma-backed code into this client
// component's bundle. An earlier version of this file duplicated the shape
// locally instead, on the theory that importing it would bundle the server
// module; that theory was false (a type-only import carries no runtime
// code), and the duplicate had already drifted (it still carried `name`/
// `userId`, which this component never reads — see that type's own doc).

type ProjectWorkerRowProps = {
  worker: ProjectWorkerRowData;
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectWorkerRow({ worker, clientId, projectId, canEdit }: ProjectWorkerRowProps) {
  const { t } = useTranslation();
  const { pending, run } = useRowAction();

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-gray-900 dark:text-gray-100">{worker.displayName}</span>
        {worker.jobFunctionName && (
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{worker.jobFunctionName}</span>
        )}
      </span>
      {canEdit && (
        <button
          type="button"
          onClick={() => run(() => detachWorker(worker.id, clientId, projectId))}
          disabled={pending}
          aria-label={format(t.workers.detachWorker, { name: worker.displayName })}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
