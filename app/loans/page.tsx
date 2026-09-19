import { findOwned, findAll } from "@/repository/equipment";
import { findHistory } from "@/repository/equipmentLoans";
import { findBorrowerOptions } from "@/repository/users";
import { getCurrentUserId } from "@/lib/currentUser";
import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { can } from "@/lib/access";
import { blockClientFromApp } from "@/lib/portal";
import { requireAreaOrRedirect } from "@/lib/areaAccess";
import { LOANS_TABS, parseLoansTabParam, type LoansTab } from "@/lib/loansTabParam";
import Title from "@/components/Title";
import EquipmentRow from "@/components/EquipmentRow";
import LoanRow, { type LoanHistoryItem } from "@/components/LoanRow";
import AddEquipmentForm from "@/forms/AddEquipmentForm";
import LendEquipmentForm from "@/forms/LendEquipmentForm";
import Link from "next/link";
import { CubeIcon, ArrowsRightLeftIcon, ClockIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

type SearchParams = { tab?: string | string[] };

const TAB_ICONS: Record<LoansTab, typeof CubeIcon> = {
  mine: CubeIcon,
  borrowed: ArrowsRightLeftIcon,
  ongoing: ClockIcon,
  returned: CheckCircleIcon,
};

export default async function LoansPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await blockClientFromApp();

  // The whole "loans" rubrique can be hidden by the caller's job function —
  // bounce to the first rubrique they can actually reach, same as
  // app/projects/page.tsx.
  await requireAreaOrRedirect("loans");

  const t = getDictionary(await getLocale());
  const session = await auth();
  // Same source as the actions this page's buttons call (docs/CONVENTIONS.md:
  // a page must decide visibility the same way its mutations decide
  // authorization, never re-derive it).
  const isAdmin = hasMinRole(session?.user?.role, "ADMIN");
  const canEdit = await can(session?.user?.role, "content.edit");
  const userId = await getCurrentUserId();

  if (!userId) {
    return (
      <main className="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
        <Title title={t.loans.title} />
        <p className="text-red-500">{t.errors.unauthorized}</p>
        <Link href="/login" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          {t.common.retry}
        </Link>
      </main>
    );
  }

  const { tab: tabParam } = await searchParams;
  const activeTab = parseLoansTabParam(tabParam);

  const [equipmentList, loanList, borrowerOptions] = await Promise.all([
    isAdmin ? findAll() : findOwned(userId),
    isAdmin ? findHistory({ all: true }) : findHistory({ ownerId: userId, borrowerId: userId }),
    findBorrowerOptions(userId),
  ]);

  // Only equipment nobody currently has may be lent out — feeds both the
  // header "Prêter un équipement" toggle and every row's own "Prêter" button
  // (LendEquipmentForm's <select> always lists every available equipment,
  // pre-filled to whichever row opened it).
  const availableEquipment = equipmentList
    .filter((e) => e.loans.length === 0)
    .map((e) => ({ id: e.id, name: e.name, reference: e.reference }));

  const borrowedLoans = loanList.filter((l) => l.borrower.id === userId && l.returnedAt === null);
  const ongoingLoans = isAdmin
    ? loanList.filter((l) => l.returnedAt === null)
    : loanList.filter((l) => l.equipment.owner.id === userId && l.returnedAt === null);
  const returnedLoans = loanList.filter((l) => l.returnedAt !== null);

  function canManageLoan(loan: LoanHistoryItem): boolean {
    return isAdmin || loan.equipment.owner.id === userId;
  }

  function tabHref(tab: LoansTab): string {
    return tab === "mine" ? "/loans" : `/loans?tab=${tab}`;
  }

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <div className="flex flex-col gap-1">
          <Title title={t.loans.title} className="text-3xl font-bold" />
          <p className="text-sm text-gray-500 dark:text-gray-400">{t.loans.subtitle}</p>
        </div>

        <nav className="grid grid-cols-4 gap-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] p-1 dark:bg-[#1f2937]" aria-label={t.loans.title}>
          {LOANS_TABS.map((tabKey) => (
            <Link
              key={tabKey}
              href={tabHref(tabKey)}
              aria-current={activeTab === tabKey ? "page" : undefined}
              className={`flex min-h-11 items-center justify-center rounded-md px-2 py-2 text-center text-xs font-medium sm:text-sm ${
                activeTab === tabKey
                  ? "bg-primary text-white"
                  : "text-gray-700 hover:bg-[#d1d5dc] dark:text-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {t.loans.tabs[tabKey]}
            </Link>
          ))}
        </nav>

        <div className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] dark:bg-[#1f2937] shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-300 dark:border-gray-700 px-4 py-4 sm:px-6">
            <h2 className="flex min-w-[8rem] flex-1 items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {(() => {
                const Icon = TAB_ICONS[activeTab];
                return <Icon className="h-5 w-5 shrink-0 text-blue-500" />;
              })()}
              <span className="truncate">{t.loans.tabs[activeTab]}</span>
            </h2>
            {activeTab === "mine" && canEdit && (
              <>
                <LendEquipmentForm
                  equipmentOptions={availableEquipment}
                  borrowerOptions={borrowerOptions}
                  triggerLabel={t.loans.lendToggle}
                />
                <AddEquipmentForm />
              </>
            )}
          </div>

          {activeTab === "mine" &&
            (equipmentList.length > 0 ? (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {equipmentList.map((e) => (
                  <EquipmentRow
                    key={e.id}
                    equipment={e}
                    canEdit={canEdit}
                    showOwner={isAdmin}
                    equipmentOptions={availableEquipment}
                    borrowerOptions={borrowerOptions}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
                {t.equipment.empty}
              </p>
            ))}

          {activeTab === "borrowed" &&
            (borrowedLoans.length > 0 ? (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {borrowedLoans.map((l) => (
                  <LoanRow key={l.id} loan={l} canManage={canEdit && canManageLoan(l)} />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">{t.loans.empty}</p>
            ))}

          {activeTab === "ongoing" &&
            (ongoingLoans.length > 0 ? (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {ongoingLoans.map((l) => (
                  <LoanRow key={l.id} loan={l} canManage={canEdit && canManageLoan(l)} />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">{t.loans.empty}</p>
            ))}

          {activeTab === "returned" &&
            (returnedLoans.length > 0 ? (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {returnedLoans.map((l) => (
                  <LoanRow key={l.id} loan={l} canManage={canEdit && canManageLoan(l)} />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">{t.loans.empty}</p>
            ))}
        </div>
      </div>
    </main>
  );
}
