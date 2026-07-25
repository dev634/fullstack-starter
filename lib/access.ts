import { getAppSettings } from "@/lib/appSettings";
import { requireRole, hasMinRole, type RoleCheckResult } from "@/lib/authz";
import { resolveAccessConfig, type Capability, type Role } from "@/lib/capabilities";

/**
 * The resolved capability → minimum-role map (stored matrix merged over the
 * defaults). Cached with app settings, so a change to the matrix busts it via
 * the same tag (see actions/appSettings).
 */
export async function getAccessConfig(): Promise<Record<Capability, Role>> {
  const settings = await getAppSettings();
  return resolveAccessConfig((settings as { accessConfig?: unknown }).accessConfig);
}

/** Guard a server action behind a configurable capability (see the matrix). */
export async function requireCapability(cap: Capability): Promise<RoleCheckResult> {
  const config = await getAccessConfig();
  return requireRole(config[cap]);
}

/** Page-level branching: does the current role satisfy the capability? */
export async function can(role: string | undefined, cap: Capability): Promise<boolean> {
  const config = await getAccessConfig();
  return hasMinRole(role, config[cap]);
}
