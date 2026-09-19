'use client'
import { deleteEquipment } from "@/actions/equipment/equipment";
import { TrashIcon, CubeIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { localeTag } from "@/lib/i18n/formatDate";
import { useDeleteConfirm } from "@/lib/useDeleteConfirm";
import Modal from "@/components/Modal";
import EditEquipmentForm from "@/forms/EditEquipmentForm";
import LendEquipmentForm, { type LendableEquipment } from "@/forms/LendEquipmentForm";
import type { BorrowerOption } from "@/types/equipment";

export type EquipmentListItem = {
  id: number;
  name: string;
  reference: string | null;
  photoUrl: string | null;
  owner: { id: number; name: string | null };
  loans: {
    id: number;
    lentAt: Date;
    dueAt: Date | null;
    borrower: { id: number; name: string | null };
  }[];
};

type EquipmentRowProps = {
  equipment: EquipmentListItem;
  canEdit: boolean;
  showOwner: boolean;
  equipmentOptions: LendableEquipment[];
  borrowerOptions: BorrowerOption[];
};

export default function EquipmentRow({
  equipment,
  canEdit,
  showOwner,
  equipmentOptions,
  borrowerOptions,
}: EquipmentRowProps) {
  const { t, locale } = useTranslation();
  const { confirming, setConfirming, pending, error, handleDelete } = useDeleteConfirm(() =>
    deleteEquipment(equipment.id)
  );
  const openLoan = equipment.loans[0] ?? null;

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {equipment.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL (public, like Client.photoUrl), not a local asset
          <img
            src={equipment.photoUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-gray-700">
            <CubeIcon className="h-5 w-5 text-gray-400 dark:text-gray-500" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{equipment.name}</span>
          {equipment.reference && (
            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{equipment.reference}</span>
          )}
          {showOwner && (
            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
              {t.equipment.ownerLabel} : {equipment.owner.name ?? t.loans.unknownUser}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {openLoan ? (
          <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-300">
            {format(t.equipment.currentlyLentTo, { name: openLoan.borrower.name ?? t.loans.unknownUser })}
            {openLoan.dueAt &&
              ` · ${t.loans.dueAtLabel} : ${new Date(openLoan.dueAt).toLocaleDateString(localeTag(locale))}`}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-green-300 bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300">
            {t.equipment.available}
          </span>
        )}

        {canEdit && !openLoan && (
          <LendEquipmentForm
            equipmentOptions={equipmentOptions}
            borrowerOptions={borrowerOptions}
            defaultEquipmentId={equipment.id}
            triggerLabel={t.equipment.lendAction}
          />
        )}
        {canEdit && (
          <EditEquipmentForm
            equipment={{
              id: equipment.id,
              name: equipment.name,
              reference: equipment.reference,
              photoUrl: equipment.photoUrl,
            }}
          />
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            aria-label={format(t.equipment.deleteEquipment, { name: equipment.name })}
            className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {confirming && (
        <Modal
          title={t.equipment.deleteTitle}
          text={format(t.equipment.deleteText, { name: equipment.name })}
          error={error ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={t.common.delete}
          onClose={() => !pending && setConfirming(false)}
          onConfirm={handleDelete}
        />
      )}
    </li>
  );
}
