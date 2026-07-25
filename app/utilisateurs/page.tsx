import { auth } from "@/lib/auth";
import { hasMinRole } from "@/lib/authz";
import { redirect } from "next/navigation";
import { findAll } from "@/repository/users";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import UsersManager from "./_components/UsersManager";
import type { Role } from "@/app/generated/prisma/client";

// Manage the app's user accounts and roles. Accessible to ADMIN and
// SUPERADMIN; an actor can never touch a role above their own (enforced in
// both the UI and the server actions).
export default async function UsersPage() {
  const session = await auth();
  if (!hasMinRole(session?.user?.role, "ADMIN")) {
    redirect("/clients");
  }

  const users = await findAll();
  const t = getDictionary(await getLocale());
  const actorRole = (session?.user?.role ?? "VIEWER") as Role;
  const actorEmail = session?.user?.email ?? "";

  return (
    <main className="flex flex-1 min-h-0 flex-col overflow-y-auto px-6 py-8">
      <div className="w-full max-w-2xl mx-auto space-y-4">
        <h1 className="text-3xl font-bold">{t.users.title}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t.users.subtitle}</p>
        <UsersManager users={users} actorRole={actorRole} actorEmail={actorEmail} />
      </div>
    </main>
  );
}
