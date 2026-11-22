import { auth } from "@/lib/auth";
import { requireAdminTab } from "@/lib/adminAccess";
import { findAll } from "@/repository/users";
import { findAllOptions as findJobFunctions, findAllHiddenAreas } from "@/repository/jobFunctions";
import { getAccessContext } from "@/lib/accessContext";
import { assignableFunctionIds, isRestrictedAdmin, unmanageableAccountIds } from "@/lib/accountPolicy";
import { findAllAssignable } from "@/repository/projects";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import UsersManager from "./_components/UsersManager";
import type { Role } from "@/app/generated/prisma/client";

// Utilisateurs tab of the Administration area. Gated by users.manage; the
// actor's role/email drive the per-row privilege guards.
export default async function AdminUsersPage() {
  await requireAdminTab("users");
  const session = await auth();
  const users = await findAll();
  const functions = await findJobFunctions();
  const projects = await findAllAssignable();
  const t = getDictionary(await getLocale());
  const actorRole = (session?.user?.role ?? "VIEWER") as Role;
  const actorEmail = session?.user?.email ?? "";

  // The relay rule (lib/accountPolicy.ts), computed once here with the SAME
  // pure functions the actions enforce, so the screen offers nothing they
  // refuse: for a restricted ADMIN (their function hides rubriques), the
  // functions they may assign (never "none") and the accounts they may not
  // manage. Ids only — the access configuration itself is not sent. `null`
  // for everyone else (nothing restricted).
  const ctx = await getAccessContext();
  const actor = { role: actorRole, hiddenAreas: ctx.hiddenAreas };
  const functionsHiddenAreas = isRestrictedAdmin(actor) ? await findAllHiddenAreas() : [];
  const restriction = isRestrictedAdmin(actor)
    ? {
        assignableFunctionIds: assignableFunctionIds(actor, functionsHiddenAreas),
        unmanageableUserIds: unmanageableAccountIds(actor, users, functionsHiddenAreas),
      }
    : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t.users.subtitle}</p>
      <UsersManager users={users} actorRole={actorRole} actorEmail={actorEmail} functions={functions} projects={projects} restriction={restriction} />
    </div>
  );
}
