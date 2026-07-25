import { auth } from "@/lib/auth";
import { requireAdminTab } from "@/lib/adminAccess";
import { findAll } from "@/repository/users";
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
  const t = getDictionary(await getLocale());
  const actorRole = (session?.user?.role ?? "VIEWER") as Role;
  const actorEmail = session?.user?.email ?? "";

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t.users.subtitle}</p>
      <UsersManager users={users} actorRole={actorRole} actorEmail={actorEmail} />
    </div>
  );
}
