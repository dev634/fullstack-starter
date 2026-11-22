import { requireAdminTab } from "@/lib/adminAccess";
import { findAll } from "@/repository/jobFunctions";
import { findFunctionIdsHeldByPrivileged, findHeldFunctionIds } from "@/repository/users";
import { isRestrictedAdmin } from "@/lib/accountPolicy";
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
  // The relay rule for a restricted ADMIN (their function hides rubriques): a
  // function held by any account cannot be deleted, nor stop hiding what they
  // hide (actions/jobFunctions refuse both). The screen gets what it needs to
  // say so with the same pure rule (mayChangeHeldFunction): the actor's own
  // hidden rubriques (already theirs) and the ids of the held functions.
  const restricted = isRestrictedAdmin(ctx);
  const restriction = restricted
    ? { actorHiddenAreas: [...ctx.hiddenAreas], heldFunctionIds: await findHeldFunctionIds() }
    : null;
  const t = getDictionary(await getLocale());

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t.jobFunctions.subtitle}</p>
      <JobFunctionsManager functions={functions} lockedFunctionIds={lockedFunctionIds} restriction={restriction} />
    </div>
  );
}
