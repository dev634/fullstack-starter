'use client'
import { deleteMaterial } from "@/actions/projectMaterials/projectMaterials";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import type { ProjectMaterial } from "@/app/generated/prisma/client";

type ProjectMaterialRowProps = {
  material: ProjectMaterial;
  clientId: number;
  projectId: number;
  canEdit: boolean;
};

export default function ProjectMaterialRow({ material, clientId, projectId, canEdit }: ProjectMaterialRowProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (pending) return;
    setPending(true);
    await deleteMaterial(material.id, clientId, projectId);
    setPending(false);
    router.refresh();
  }

  const secondary = [material.supplierName, material.reference].filter(Boolean).join(" · ");

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-gray-900 dark:text-gray-100">{material.name}</span>
        {secondary && (
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{secondary}</span>
        )}
      </span>
      <span className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
        {material.quantity}
        {material.unit ? ` ${material.unit}` : ""}
      </span>
      {canEdit && (
        <button
          type="button"
          onClick={handleDelete}
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
