import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getAccessConfig } from "@/lib/access";
import { hasMinRole } from "@/lib/authz";
import { canAccessArea } from "@/lib/areaAccess";

// Administration-area access helpers. Kept separate from lib/access (the pure
// capability guards used by server actions) because these pull in the auth
// session and next/navigation redirect — a heavier, page-only dependency set.

/**
 * Which Administration tabs the given role may open, plus the first one to land
 * on. The area's tabs are each gated by a capability, so with the configurable
 * matrix a role may reach some tabs and not others. `landing` is the canonical
 * redirect target when a role hits the area (or a tab it can't open) — always
 * an accessible tab, so there's no redirect loop; `null` when none are.
 */
export type AdminAccess = {
  functions: boolean;
  users: boolean;
  settings: boolean;
  any: boolean;
  landing: string | null;
};

export async function getAdminAccess(role: string | undefined): Promise<AdminAccess> {
  const config = await getAccessConfig();
  // Visibility of each tab = the RBAC capability (role) AND not withheld by
  // the caller's job function (hiddenAreas — admin.users/functions/settings).
  // The function can only ever narrow a tab a role's capability already
  // allows, never grant one it doesn't — see lib/areaAccess.ts.
  const functions = hasMinRole(role, config["functions.manage"]) && (await canAccessArea("admin.functions"));
  const users = hasMinRole(role, config["users.manage"]) && (await canAccessArea("admin.users"));
  const settings = hasMinRole(role, config["settings.manage"]) && (await canAccessArea("admin.settings"));
  const landing = functions
    ? "/admin/settings/fonctions"
    : users
      ? "/admin/settings/utilisateurs"
      : settings
        ? "/admin/settings"
        : null;
  return { functions, users, settings, any: functions || users || settings, landing };
}

/**
 * Guard an Administration tab page: redirect a role that can't open this tab
 * to the first tab it can (or out of the area). Returns the full access set so
 * the page can branch further. Centralizes the per-tab guard the five tab
 * pages would otherwise repeat.
 */
export async function requireAdminTab(
  tab: "functions" | "users" | "settings"
): Promise<AdminAccess> {
  const session = await auth();
  const access = await getAdminAccess(session?.user?.role);
  if (!access[tab]) {
    redirect(access.landing ?? "/clients");
  }
  return access;
}
