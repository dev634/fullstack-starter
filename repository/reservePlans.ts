import { prisma } from "@/lib/prisma";
import type { CloudinaryDeliveryType, CloudinaryResourceType } from "@/app/generated/prisma/client";

type ReservePlanData = {
    projectId: number;
    name: string;
    // DEPRECATED — see ProjectFile.url's doc (prisma/schema.prisma). Still
    // written, never read back.
    url: string;
    publicId: string;
    deliveryType: CloudinaryDeliveryType;
    resourceType: CloudinaryResourceType;
    format?: string | null;
    version?: string | null;
    folderId?: number | null;
};

// Passe 3b (C2), point 4: findByProject had no ceiling at all — flagged twice
// (PR #190's audit and the adversarial pass). A chantier with thousands of
// réserves on one plan loaded every one of them, AND every one of their
// photos, in a single query, then passed the whole tree into a Client
// Component's props (project page) or rendered a client component
// (ReserveStatusBadge) per row (the portal page). No genuine floor plan
// carries anywhere near this many individually-pinned snags — this is a
// defensive ceiling against a pathological/adversarial row count, the same
// role `take: 10000` plays in repository/contacts.ts's CSV export, not a
// routine page size a real user is expected to hit.
const RESERVES_PER_PLAN_LIMIT = 1000;

/**
 * Plans of a project, oldest first, each with its pinned réserves. Consumed
 * both by the project page (which passes it straight into ReservesSection, a
 * Client Component) and by the réserves report route (server-only). `url` is
 * omitted at both levels (plan + nested photo) so it never ends up in a
 * Client Component's serialized props — see ProjectFile.url's doc in
 * prisma/schema.prisma. The report route never read it either way (it signs
 * its own delivery URLs from publicId + the guarded columns).
 *
 * `boundReserves` caps each plan's nested `reserves` at RESERVES_PER_PLAN_LIMIT
 * — left `false` (the default, and the report route's own call) for the PDF
 * snagging report, which is a formal document that must stay exhaustive; a
 * silently incomplete report is worse than the slow query it would avoid.
 * The two display surfaces (project page, portal page) opt in instead.
 * `_count.reserves` — the row's TRUE count — travels on every plan
 * regardless of `boundReserves`, so a caller can always tell whether what it
 * got is everything or a prefix, and render "…and N more" rather than let a
 * truncated fetch look like the whole project (see
 * components/ReservesSection.tsx and app/portail/.../page.tsx). It is NOT
 * itself a safe substitute for summarizeReserves's open/resolved breakdown
 * when a plan is actually truncated — see repository/reserves.ts's own
 * tallyByProject for the accurate, unbounded equivalent used instead for any
 * project-wide total.
 */
export async function findByProject(projectId: number, options?: { boundReserves?: boolean }) {
    try {
        return await prisma.reservePlan.findMany({
            where: { projectId },
            orderBy: { createdAt: "asc" },
            omit: { url: true },
            include: {
                reserves: {
                    orderBy: { createdAt: "asc" },
                    ...(options?.boundReserves ? { take: RESERVES_PER_PLAN_LIMIT } : {}),
                    include: { photos: { orderBy: { createdAt: "asc" }, omit: { url: true } } },
                },
                _count: { select: { reserves: true } },
            },
        });
    } catch (error) {
        console.log("Repository findByProject (reservePlan) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching plans." };
    }
}

/**
 * `url` is omitted here too — used by the guarded delivery route (which
 * signs its own URL from publicId + the guarded columns, never reads it
 * back) and by the plan mutations (which only need publicId/deliveryType/
 * resourceType/projectId) — see ProjectFile.url's doc in
 * prisma/schema.prisma for why the column must never travel further than it
 * has to.
 */
export async function findById(id: number) {
    try {
        return await prisma.reservePlan.findUnique({ where: { id }, omit: { url: true } });
    } catch (error) {
        console.log("Repository findById (reservePlan) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching plan." };
    }
}

/**
 * The created row is returned as `data` by addReservePlan straight to a
 * Client Component (AddReservePlanForm) — `url` is omitted from what comes
 * back so that response never carries it, even though the column is still
 * written (see ReservePlanData.url's doc above).
 */
export async function create(data: ReservePlanData) {
    try {
        return await prisma.reservePlan.create({
            data: {
                projectId: data.projectId,
                name: data.name,
                url: data.url,
                publicId: data.publicId,
                deliveryType: data.deliveryType,
                resourceType: data.resourceType,
                format: data.format ?? null,
                version: data.version ?? null,
                folderId: data.folderId ?? null,
            },
            omit: { url: true },
        });
    } catch (error) {
        console.log("Repository create (reservePlan) error:", error);
        throw { type: "repositoryError", message: "Database Error creating plan." };
    }
}

/**
 * Move a plan into a folder (or to the project root when `folderId` is null).
 * Scoped to `projectId`: the plan and, when set, the target folder must both
 * belong to it, so a stray id can't move another project's plan or file it
 * under a foreign folder.
 */
export async function setFolder(planId: number, folderId: number | null, projectId: number) {
    try {
        if (folderId != null) {
            const folder = await prisma.reservePlanFolder.findFirst({
                where: { id: folderId, projectId },
                select: { id: true },
            });
            if (!folder) throw { type: "error", message: "Folder not found in this project." };
        }
        return await prisma.reservePlan.updateMany({
            where: { id: planId, projectId },
            data: { folderId },
        });
    } catch (error) {
        console.log("Repository setFolder (reservePlan) error:", error);
        throw { type: "repositoryError", message: "Database Error moving plan." };
    }
}

/**
 * Deletes a plan (cascades to its réserves) and returns it — deleteReservePlan
 * uses a row fetched separately (`findById`, before the delete) for the
 * actual Cloudinary cleanup, and only forwards THIS return value as `data` in
 * its response to the client, so `url` is omitted here too.
 */
export async function remove(id: number) {
    try {
        return await prisma.reservePlan.delete({ where: { id }, omit: { url: true } });
    } catch (error) {
        console.log("Repository remove (reservePlan) error:", error);
        throw { type: "repositoryError", message: "Database Error deleting plan." };
    }
}
