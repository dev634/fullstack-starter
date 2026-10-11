import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { findByUserEmail } from "@/repository/contacts";

/**
 * The scope of a client-portal session: the contact behind the CLIENT login,
 * its company, and the exact set of project ids it may see. Everything the
 * portal renders or mutates is checked against `projectIds` — the single
 * source of truth for what a client can reach.
 */
export type PortalContext = {
  contactId: number;
  clientId: number;
  companyName: string;
  projectIds: Set<number>;
};

/**
 * First line of a main-app page: the caller must be a signed-in, non-CLIENT
 * user. Two redirects, in this order, mirroring the proxy's own two rules but
 * in Node, where the session is fully resolved:
 *
 *   1. No session → `/login`. This is the rule the Edge proxy cannot enforce
 *      alone: it runs on authConfig, with no database, so it still sees a
 *      structurally valid, correctly signed cookie after lib/sessionGate.ts
 *      has voided the account it names (deleted account) or could not verify
 *      it (database down). In Node, `auth()` has already resolved those to no
 *      session at all, and this sends that caller where a never-authenticated
 *      visitor goes — instead of letting an absent session act as an app user.
 *   2. A CLIENT login → `/portail`. The proxy is the primary boundary for this
 *      one; this second layer runs inside the render (where `auth()` always
 *      has the role) so a client can never see company/project data even if
 *      the proxy check ever regresses.
 *
 * The name only says the second half. It predates the first rule and is kept
 * on purpose: many app pages call it by this name, and renaming them all is
 * its own change.
 */
export async function blockClientFromApp(): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role === "CLIENT") redirect("/portail");
}

/** Resolve the portal scope for the current CLIENT session, or null. */
export async function getPortalContext(): Promise<PortalContext | null> {
  const session = await auth();
  if (session?.user?.role !== "CLIENT" || !session.user.email) return null;
  const contact = await findByUserEmail(session.user.email);
  if (!contact) return null;
  return {
    contactId: contact.id,
    clientId: contact.client.id,
    companyName: contact.client.companyName,
    projectIds: new Set(contact.projects.map((p) => p.id)),
  };
}

/**
 * Guard a portal page: return the scope, or redirect out if the caller isn't a
 * properly-provisioned CLIENT. The proxy already keeps non-CLIENT roles out of
 * /portail, so this mainly handles a CLIENT login with no contact/projects.
 */
export async function requirePortalContext(): Promise<PortalContext> {
  const ctx = await getPortalContext();
  if (!ctx) redirect("/login");
  return ctx;
}
