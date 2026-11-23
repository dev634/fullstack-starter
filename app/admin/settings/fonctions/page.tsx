import { requireAdminTab } from "@/lib/adminAccess";
import { findAll } from "@/repository/jobFunctions";
import { findFunctionIdsHeldByPrivileged, findHeldFunctionIds } from "@/repository/users";
import { heldFunctionLocks, isRestrictedAdmin } from "@/lib/accountPolicy";
import { normalizeHiddenAreas } from "@/lib/appAreas";
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
  // The relay rule for a restricted ADMIN (their function hides rubriques a
  // lower role can reach): a function held by any account may not be deleted
  // if it hides one of theirs, nor stop hiding one it hides (actions/jobFunctions
  // refuse both). The decision is taken HERE, with the rule the actions
  // enforce (lib/accountPolicy.ts::heldFunctionLocks), and only its result goes
  // to the browser: which functions cannot be deleted, and which of the actor's
  // own rubriques each held function cannot be made to reveal.
  const restricted = isRestrictedAdmin(ctx);
  const heldFunctionIds = restricted ? await findHeldFunctionIds() : [];
  const locks = heldFunctionLocks(
    ctx,
    functions.map((f) => ({ id: f.id, hiddenAreas: normalizeHiddenAreas(f.hiddenAreas) })),
    heldFunctionIds
  );
  const t = getDictionary(await getLocale());

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t.jobFunctions.subtitle}</p>
      <JobFunctionsManager
        functions={functions}
        lockedFunctionIds={lockedFunctionIds}
        deleteLockedIds={locks.deleteLockedIds}
        lockedAreasByFunctionId={locks.lockedAreasByFunctionId}
      />
    </div>
  );
}
