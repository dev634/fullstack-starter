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
 * Server-side belt-and-suspenders: bounce a CLIENT login out of a normal app
 * page to the portal. The proxy is the primary boundary; this second layer runs
 * inside the page render (where `auth()` always has the role) so a client can
 * never see company/project data even if the proxy check ever regresses.
 */
export async function blockClientFromApp(): Promise<void> {
  const session = await auth();
  if (session?.user?.role === "CLIENT") redirect("/portail");
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
