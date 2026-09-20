import { findOwned, findAll } from "@/repository/equipment";
import { findHistory } from "@/repository/equipmentLoans";
import { findBorrowerOptions } from "@/repository/users";
import { getLoansActor } from "@/lib/currentUser";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import { blockClientFromApp } from "@/lib/portal";
import { requireAreaOrRedirect } from "@/lib/areaAccess";
import { LOANS_TABS, parseLoansTabParam, type LoansTab } from "@/lib/loansTabParam";
import { format } from "@/lib/i18n/format";
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

// Only the unbounded admin reads (findAll with no owner filter,
// findHistory({all: true}) with no owner/borrower filter) need a ceiling —
// findOwned/findHistory({ownerId, borrowerId}) are already naturally bounded
// by one person's own equipment/loans. 500 is generous for a personal-tools
// module; the page says so (t.loans.listTruncated) if it's ever actually hit
// instead of silently showing a partial list.
const LOANS_ADMIN_LIST_TAKE = 500;

export default async function LoansPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await blockClientFromApp();

  // The whole "loans" rubrique can be hidden by the caller's job function —
  // bounce to the first rubrique they can actually reach, same as
  // app/projects/page.tsx.
  await requireAreaOrRedirect("loans");

  const t = getDictionary(await getLocale());
  const session = await auth();
  const canEdit = await can(session?.user?.role, "content.edit");
  // Same source as the actions this page's buttons call (docs/CONVENTIONS.md:
  // a page must decide visibility the same way its mutations decide
  // authorization, never re-derive it) — lib/currentUser.ts::getLoansActor.
  const actor = await getLoansActor();

  if (!actor) {
    return (
      <main className="flex flex-1 min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-8 text-center">
        <Title title={t.loans.title} />
        <p className="text-red-500">{t.errors.unauthorized}</p>
        <Link href="/login" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          {t.auth.signIn}
        </Link>
      </main>
    );
  }
  const { userId, isAdmin } = actor;

  const { tab: tabParam } = await searchParams;
  const activeTab = parseLoansTabParam(tabParam);

  // Loaded by tab, not all at once: "mine" needs the equipment catalogue (+
  // the borrower directory, but only for someone who can actually lend —
  // a VIEWER never receives it, not even unused); the three history tabs
  // need only findHistory. Neither the equipment list nor the borrower
  // directory is fetched at all outside "mine".
  const equipmentList =
    activeTab === "mine" ? (isAdmin ? await findAll({ take: LOANS_ADMIN_LIST_TAKE }) : await findOwned(userId)) : [];
  const borrowerOptions = activeTab === "mine" && canEdit ? await findBorrowerOptions(userId) : [];
  // The admin read is bounded (take), so the tab's own predicate goes INTO
  // the query: "returned" reads closed loans, the other two read open ones.
  // Bounding first and filtering after would keep the 500 most recent loans
  // of any status and lose the oldest OPEN ones — the overdue ones.
  const loanStatus = activeTab === "returned" ? "returned" : "open";
  // Fetch one row past the bound: a list of exactly `take` rows can't tell
  // "there were more" from "there were exactly that many". The extra row is
  // sliced off below, never rendered.
  const loanList =
    activeTab === "mine"
      ? []
      : isAdmin
        ? await findHistory({ all: true, status: loanStatus, take: LOANS_ADMIN_LIST_TAKE + 1 })
        : await findHistory({ ownerId: userId, borrowerId: userId });

  const equipmentListTruncated = activeTab === "mine" && isAdmin && equipmentList.length === LOANS_ADMIN_LIST_TAKE;
  const loanListTruncated = activeTab !== "mine" && isAdmin && loanList.length > LOANS_ADMIN_LIST_TAKE;
  if (loanListTruncated) loanList.length = LOANS_ADMIN_LIST_TAKE;

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

  // Decision A: the borrower may also mark THEIR OWN loan returned, on top
  // of canManageLoan's owner/admin authority — same shape returnLoan checks
  // (actions/equipmentLoans/equipmentLoans.ts).
  function canReturnLoan(loan: LoanHistoryItem): boolean {
    return canManageLoan(loan) || loan.borrower.id === userId;
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

        <nav
          className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-[#f3f4f6] p-1 dark:bg-[#1f2937]"
          aria-label={t.loans.title}
        >
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

          {(equipmentListTruncated || loanListTruncated) && (
            <p className="border-b border-gray-300 px-4 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400 sm:px-6">
              {format(t.loans.listTruncated, { take: LOANS_ADMIN_LIST_TAKE })}
            </p>
          )}

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
                  <LoanRow key={l.id} loan={l} canManage={canEdit && canManageLoan(l)} canReturn={canEdit && canReturnLoan(l)} />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">{t.loans.empty}</p>
            ))}

          {activeTab === "ongoing" &&
            (ongoingLoans.length > 0 ? (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {ongoingLoans.map((l) => (
                  <LoanRow key={l.id} loan={l} canManage={canEdit && canManageLoan(l)} canReturn={canEdit && canReturnLoan(l)} />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">{t.loans.empty}</p>
            ))}

          {activeTab === "returned" &&
            (returnedLoans.length > 0 ? (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700">
                {returnedLoans.map((l) => (
                  <LoanRow key={l.id} loan={l} canManage={canEdit && canManageLoan(l)} canReturn={canEdit && canReturnLoan(l)} />
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
