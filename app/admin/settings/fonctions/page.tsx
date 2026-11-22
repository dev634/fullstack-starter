import { requireAdminTab } from "@/lib/adminAccess";
import { findAll } from "@/repository/jobFunctions";
import { findFunctionIdsHeldByPrivileged } from "@/repository/users";
import { getAccessContext } from "@/lib/accessContext";
import { hasMinRole } from "@/lib/authz";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import JobFunctionsManager from "./_components/JobFunctionsManager";

// Fonctions tab of the Administration area. Gated by functions.manage.
export default async function AdminFonctionsPage() {
  await requireAdminTab("functions");
  const functions = await findAll();
  // A function held by an ADMIN / SUPERADMIN account may only be changed or
  // deleted by a SUPERADMIN (actions/jobFunctions refuse it): same rule, same
  // read (countPrivilegedHolders), so the screen offers nothing the server
  // would refuse. A SUPERADMIN has nothing locked.
  const ctx = await getAccessContext();
  const lockedFunctionIds = hasMinRole(ctx.role, "SUPERADMIN") ? [] : await findFunctionIdsHeldByPrivileged();
  const t = getDictionary(await getLocale());

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t.jobFunctions.subtitle}</p>
      <JobFunctionsManager functions={functions} lockedFunctionIds={lockedFunctionIds} />
    </div>
  );
}
