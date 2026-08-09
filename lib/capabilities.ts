// Client-safe RBAC primitives — no server imports, so both server gates
// (lib/access.ts) and client UI can share the role ranks + capability list.

// Ranks are relative — higher outranks lower. CLIENT is the floor (external
// portal users); 0 stays reserved for "no/unknown role" so an unauthenticated
// caller never meets even a CLIENT-min capability.
export const ROLE_RANK = { SUPERADMIN: 5, ADMIN: 4, EDITOR: 3, VIEWER: 2, CLIENT: 1 } as const;
export type Role = keyof typeof ROLE_RANK;
export const ROLES: Role[] = ["SUPERADMIN", "ADMIN", "EDITOR", "VIEWER", "CLIENT"];

// Roles a SUPERADMIN may set as a capability's minimum in the "Rôles & accès"
// matrix. CLIENT is deliberately EXCLUDED: client-portal contributions are not
// yet project-scoped, so a content capability set to CLIENT-min would grant
// clients unscoped write access to any project. resolveAccessConfig also
// rejects a CLIENT value, so even a tampered config can't lower a gate to it.
export const MATRIX_MIN_ROLES: Role[] = ROLES.filter((r) => r !== "CLIENT");

/** The capabilities whose required minimum role a SUPERADMIN can configure. */
export const CAPABILITIES = [
  "content.edit",
  "content.trash",
  "content.import",
  "content.activity",
  "functions.manage",
  "users.manage",
  "settings.manage",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// Defaults = the app's current hardcoded behaviour, so switching to the
// configurable system changes nothing until a SUPERADMIN edits the matrix.
export const DEFAULT_CAPABILITY_ROLE: Record<Capability, Role> = {
  "content.edit": "EDITOR",
  "content.trash": "EDITOR",
  "content.import": "EDITOR",
  "content.activity": "EDITOR",
  "functions.manage": "ADMIN",
  "users.manage": "ADMIN",
  "settings.manage": "SUPERADMIN",
};

// settings.manage gates the matrix itself + theme/section order — always
// SUPERADMIN so no one can lower the bar on the permission system and lock the
// owner out. Shown in the matrix read-only for transparency.
//
// functions.manage and users.manage joined it in passe 3b, point 4, for the
// same reason applied to the other two axes this matrix doesn't touch
// (function → sections, function → areas, function → projects — see
// docs/CONVENTIONS.md): resolveAccessConfig below IGNORES whatever is stored
// for a locked capability and forces it back to DEFAULT_CAPABILITY_ROLE
// (ADMIN for both) — so locking them here changes nothing for the ADMIN
// accounts that already hold them today. What it closes: an EDITOR who'd
// been granted functions.manage could call setFunctionAreas on their OWN
// function and clear its hiddenAreas/hiddenSections entirely — annulling two
// of the three access axes for themselves in one write, with no ADMIN/
// SUPERADMIN step in between. Locking the capability that GRANTS that write
// at EDITOR-or-below is the fix; it does not touch the passe 3b, point 3
// self-lock guard in setFunctionAreas itself (that one stops an ADMIN from
// touching their OWN function even while legitimately holding the
// capability — a different, narrower case).
export const LOCKED_CAPABILITIES: readonly Capability[] = ["settings.manage", "functions.manage", "users.manage"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && value in ROLE_RANK;
}

export function rankOf(role: string | undefined | null): number {
  return role && role in ROLE_RANK ? ROLE_RANK[role as Role] : 0;
}

/** Does `role` meet a minimum role? */
export function meetsRole(role: string | undefined | null, minRole: Role): boolean {
  return rankOf(role) >= ROLE_RANK[minRole];
}

/** Does `role` satisfy a capability, given a resolved config? */
export function hasCapability(
  role: string | undefined | null,
  cap: Capability,
  config: Record<Capability, Role>
): boolean {
  return meetsRole(role, config[cap]);
}

/**
 * Merge a stored (partial, possibly stale) config over the defaults, ignoring
 * unknown/invalid entries and forcing locked capabilities to their default.
 * A CLIENT value is rejected (falls back to the default): a capability may not
 * be lowered to the client-portal role until client contributions are scoped.
 */
export function resolveAccessConfig(stored: unknown): Record<Capability, Role> {
  const config = { ...DEFAULT_CAPABILITY_ROLE };
  const raw = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  for (const cap of CAPABILITIES) {
    if (LOCKED_CAPABILITIES.includes(cap)) continue;
    const v = raw[cap];
    if (isRole(v) && v !== "CLIENT") config[cap] = v;
  }
  return config;
}
