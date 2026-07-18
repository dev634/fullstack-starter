'use client'
import { deleteMaterial } from "@/actions/projectMaterials/projectMaterials";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { materialStockStatus, STOCK_DOT_CLASSES } from "@/lib/materialStock";
import { useRowAction } from "@/lib/useRowAction";
import EditMaterialForm from "@/forms/EditMaterialForm";
import type { ProjectMaterial } from "@/app/generated/prisma/client";

type MaterialWithTask = ProjectMaterial & {
  task: { id: number; title: string } | null;
  taskGroup: { id: number; name: string } | null;
  taskCategory: { id: number; name: string } | null;
};

type ProjectMaterialRowProps = {
  material: MaterialWithTask;
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectMaterialRow({ material, clientId, projectId, canEdit }: ProjectMaterialRowProps) {
  const { t } = useTranslation();
  const { pending, run } = useRowAction();

  const linkedName = material.task?.title ?? material.taskGroup?.name ?? material.taskCategory?.name ?? null;
  const secondaryParts = [material.supplierName, material.reference];
  if (linkedName) secondaryParts.push(format(t.materials.linkedTask, { title: linkedName }));
  const secondary = secondaryParts.filter(Boolean).join(" · ");

  // Gated on requiredQuantity alone (not also on linkedName) so this stays
  // in lockstep with lib/projectDashboard.ts's computeMaterialStockStats/
  // computeTrackedMaterials, which use the same single predicate — a
  // material whose linked task/series/category was since deleted (SetNull
  // clears the link but not requiredQuantity) still shows a status here
  // exactly like it still does on the dashboard, instead of disagreeing.
  const status = material.requiredQuantity != null
    ? materialStockStatus(material.quantity, material.requiredQuantity)
    : null;

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
      {status && (
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${STOCK_DOT_CLASSES[status]}`}
          title={t.materials.stockStatus[status]}
          aria-label={t.materials.stockStatus[status]}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-gray-900 dark:text-gray-100">{material.name}</span>
        {secondary && (
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{secondary}</span>
        )}
      </span>
      <span className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
        {material.quantity}
        {material.unit ? ` ${material.unit}` : ""}
        {material.requiredQuantity != null && (
          <span className="text-gray-400 dark:text-gray-500"> / {material.requiredQuantity}</span>
        )}
      </span>
      {canEdit && (
        <EditMaterialForm
          material={{
            id: material.id,
            name: material.name,
            quantity: material.quantity,
            unit: material.unit,
            supplierName: material.supplierName,
            reference: material.reference,
            requiredQuantity: material.requiredQuantity,
            isLinked: linkedName != null,
          }}
          clientId={clientId}
          projectId={projectId}
        />
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => run(() => deleteMaterial(material.id, clientId, projectId))}
          disabled={pending}
          aria-label={format(t.materials.deleteMaterial, { name: material.name })}
          className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
