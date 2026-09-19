'use client'
import { deleteLoan } from "@/actions/equipmentLoans/equipmentLoans";
import { TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { localeTag } from "@/lib/i18n/formatDate";
import { useDeleteConfirm } from "@/lib/useDeleteConfirm";
import Modal from "@/components/Modal";
import ReturnLoanForm from "@/forms/ReturnLoanForm";
import EditLoanForm from "@/forms/EditLoanForm";

export type LoanHistoryItem = {
  id: number;
  lentAt: Date;
  dueAt: Date | null;
  returnedAt: Date | null;
  note: string | null;
  equipment: {
    id: number;
    name: string;
    reference: string | null;
    owner: { id: number; name: string | null };
  };
  borrower: { id: number; name: string | null };
};

type LoanRowProps = {
  loan: LoanHistoryItem;
  /** Whether the current viewer may return/edit/delete THIS loan — the
   * equipment's owner or an admin, same authority the server actions check
   * (actions/equipmentLoans/equipmentLoans.ts). A borrower who isn't also the
   * owner (or an admin) only ever sees this row read-only. */
  canManage: boolean;
};

export default function LoanRow({ loan, canManage }: LoanRowProps) {
  const { t, locale } = useTranslation();
  const { confirming, setConfirming, pending, error, handleDelete } = useDeleteConfirm(() => deleteLoan(loan.id));
  const tag = localeTag(locale);

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3 sm:px-6">
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {loan.equipment.reference ? `${loan.equipment.name} (${loan.equipment.reference})` : loan.equipment.name}
        </span>
        <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
          {t.equipment.ownerLabel} : {loan.equipment.owner.name ?? t.loans.unknownUser} · {t.loans.borrowerLabel} :{" "}
          {loan.borrower.name ?? t.loans.unknownUser}
        </span>
        <span className="block text-xs text-gray-500 dark:text-gray-400">
          {t.loans.lentAtLabel} : {new Date(loan.lentAt).toLocaleDateString(tag)}
          {loan.dueAt && ` · ${t.loans.dueAtLabel} : ${new Date(loan.dueAt).toLocaleDateString(tag)}`}
          {loan.returnedAt && ` · ${t.loans.returnedAtLabel} : ${new Date(loan.returnedAt).toLocaleDateString(tag)}`}
        </span>
        {loan.note && <span className="block truncate text-xs italic text-gray-400 dark:text-gray-500">{loan.note}</span>}
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {!loan.returnedAt && <ReturnLoanForm loanId={loan.id} />}
          <EditLoanForm loan={{ id: loan.id, dueAt: loan.dueAt, note: loan.note }} />
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            aria-label={t.loans.deleteLoan}
            className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {confirming && (
        <Modal
          title={t.loans.deleteTitle}
          text={t.loans.deleteText}
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
