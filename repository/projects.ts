import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";

export type ProjectSortField = "name" | "status" | "createdAt";

/**
 * The (non-trashed) projects with the given ids — used by the client portal,
 * which passes exactly the ids the logged-in contact is linked to. An empty
 * list yields no rows.
 */
export async function findByIds(ids: number[]) {
    try {
        if (ids.length === 0) return [];
        return await prisma.project.findMany({
            where: { id: { in: ids }, deletedAt: null },
            orderBy: [{ createdAt: "desc" }],
            select: {
                id: true,
                name: true,
                type: true,
                status: true,
                businessNumber: true,
                client: { select: { id: true, companyName: true } },
            },
        });
    } catch (error) {
        console.log("Repository findByIds (project) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching projects." };
    }
}

type ProjectSearchArgs = {
    q?: string;
    sortField?: ProjectSortField;
    dir?: "asc" | "desc";
    page?: number;
    pageSize?: number;
};

/**
 * Paginated, filterable listing across every client's projects. `q` matches
 * the project name or the owning client's name/company. Excludes projects
 * whose client is in the trash.
 */
export async function search({
    q = "",
    sortField = "createdAt",
    dir = "desc",
    page = 1,
    pageSize = 12,
    projectIds,
}: ProjectSearchArgs & { projectIds?: number[] }) {
    const term = q.trim();
    const where: Prisma.ProjectWhereInput = {
        deletedAt: null,
        client: { deletedAt: null },
        // Restricted callers pass the projects they're assigned to. undefined
        // means unrestricted; an EMPTY array must still match nothing, so this
        // is a presence check, not a truthiness one.
        ...(projectIds !== undefined ? { id: { in: projectIds } } : {}),
        ...(term
            ? {
                OR: [
                    { name: { contains: term, mode: Prisma.QueryMode.insensitive } },
                    { client: { companyName: { contains: term, mode: Prisma.QueryMode.insensitive } } },
                    { client: { email: { contains: term, mode: Prisma.QueryMode.insensitive } } },
                ],
            }
            : {}),
    };

    try {
        const [projects, total] = await Promise.all([
            prisma.project.findMany({
                where,
                include: {
                    client: { select: { id: true, companyName: true, email: true } },
                },
                orderBy: { [sortField]: dir } as Prisma.ProjectOrderByWithRelationInput,
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            prisma.project.count({ where }),
        ]);
        return { projects, total };
    } catch (error) {
        console.log("Repository search (project) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error searching projects.",
        };
    }
}

type ProjectData = {
    clientId: number;
    name: string;
    businessNumber?: string;
    type?: string;
    status: string;
    power?: number;
    budget?: number;
    address?: string;
    startDate?: string;
    endDate?: string;
    notes?: string;
};

export async function create(data: ProjectData) {
    try {
        const project = await prisma.project.create({
            data: {
                clientId: data.clientId,
                name: data.name,
                businessNumber: data.businessNumber || null,
                type: (data.type ?? "AUTRE") as never,
                status: data.status as never,
                power: data.power ?? null,
                budget: data.budget ?? null,
                address: data.address || null,
                startDate: data.startDate ? new Date(data.startDate) : null,
                endDate: data.endDate ? new Date(data.endDate) : null,
                notes: data.notes || null,
            },
        });
        return project;
    } catch (error) {
        console.log("Repository create project error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error creating project.",
        };
    }
}

/** Projects for a client, most recently created first. Excludes trashed projects. */
export async function findByClient(clientId: number, projectIds?: number[]) {
    try {
        return await prisma.project.findMany({
            where: {
                clientId,
                deletedAt: null,
                // Restricted callers only see the chantiers they hold, even
                // inside a company they can otherwise reach.
                ...(projectIds !== undefined ? { id: { in: projectIds } } : {}),
            },
            orderBy: { createdAt: "desc" },
        });
    } catch (error) {
        console.log("Repository findByClient error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching projects.",
        };
    }
}

export async function findById(id: number) {
    try {
        return await prisma.project.findUnique({
            where: { id },
            // La relation client est resserree a ce que ses appelants lisent
            // reellement — un seul champ, le nom de l entreprise sur la page
            // de garde du rapport PDF. `client: true` remontait la ligne
            // entiere (email, telephone, adresse, site), et deux pages la
            // passaient telle quelle a un composant client : React serialise
            // alors TOUT dans la charge RSC, donc dans le HTML. Un compte a
            // qui la rubrique `clients` a ete retiree les lisait dans la
            // source d une page gardee par la rubrique `projects`.
            // Resserrer ici plutot que sur chaque site d appel : un Pick sur
            // la prop ne protege rien (le typage structurel accepte une valeur
            // plus large), seule l absence de la donnee la rend impossible a
            // fuir.
            include: { client: { select: { companyName: true } } },
        });
    } catch (error) {
        console.log("Repository findById (project) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching project.",
        };
    }
}

/**
 * The subset of a project's columns the client portal is allowed to render —
 * `budget` and `notes` (internal cost/margin and private remarks) are never
 * selected, not merely left unrendered. `findById` above stays untouched: it
 * is shared with the application (`getProject`, the guarded asset route, the
 * réserves report route, the delivery-note-scan action), all of which
 * legitimately need the full row, `client` relation included.
 *
 * A dedicated `select` was chosen over `findById(...)` + `omit`/destructuring
 * for two reasons: it also drops the `client` include the portal page never
 * reads (it already has the company name from its own PortalContext), and it
 * keeps "what the portal may see" declared in one place instead of trusting
 * every future caller to remember to strip the sensitive fields back out.
 */
export async function findByIdForPortal(id: number) {
    try {
        return await prisma.project.findUnique({
            where: { id },
            select: {
                id: true,
                clientId: true,
                name: true,
                type: true,
                status: true,
                businessNumber: true,
                power: true,
                address: true,
                startDate: true,
                endDate: true,
                deletedAt: true,
                // Not sensitive (unlike budget/notes, deliberately excluded
                // above) — the portal's own réserves view needs these to
                // render the exact same status labels/colours as the
                // internal app (lib/reserveStatusStyle.ts's
                // resolveReserveStatusStyle). Omitting them here wouldn't
                // fail loudly: this allowlist would just silently fall back
                // to the product default on the portal only, while the
                // internal project page (findById, no select) already shows
                // the project's real configuration.
                reserveOpenLabel: true,
                reserveOpenColor: true,
                reserveResolvedLabel: true,
                reserveResolvedColor: true,
            },
        });
    } catch (error) {
        console.log("Repository findByIdForPortal (project) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching project.",
        };
    }
}

/**
 * Whether the client has at least one (non-trashed) project among the given
 * ids — used by requireClientAccess (lib/access.ts) to decide if a
 * caller restricted to specific projects may reach a client-level action at
 * all, the same reachability rule already used to filter the client
 * list/export (repository/clients.ts::search).
 */
export async function hasProjectAmong(clientId: number, projectIds: number[]): Promise<boolean> {
    if (projectIds.length === 0) return false;
    try {
        const found = await prisma.project.findFirst({
            where: { clientId, id: { in: projectIds }, deletedAt: null },
            select: { id: true },
        });
        return found !== null;
    } catch (error) {
        console.log("Repository hasProjectAmong (project) error:", error);
        throw { type: "repositoryError", message: "Database Error checking project access." };
    }
}

/**
 * Distinct client ids owning any of the given project ids — used to scope
 * the client activity log (repository/activity.ts) to a restricted caller.
 * ActivityLog has no relation to Client (its `clientId` is a plain field so
 * the audit trail survives a permanent delete), so client-side visibility
 * for that log is derived here instead: "did I hold a project under this
 * company", regardless of that project's current live/trashed state — the
 * log is a historical record, not a live listing, so a project the caller
 * later deleted must still resolve its owning client.
 */
export async function findClientIdsAmong(projectIds: number[]): Promise<number[]> {
    if (projectIds.length === 0) return [];
    try {
        const rows = await prisma.project.findMany({
            where: { id: { in: projectIds } },
            select: { clientId: true },
            distinct: ["clientId"],
        });
        return rows.map((r) => r.clientId);
    } catch (error) {
        console.log("Repository findClientIdsAmong error:", error);
        throw { type: "repositoryError", message: "Database Error resolving client scope." };
    }
}

export async function update(id: number, data: ProjectData) {
    try {
        const project = await prisma.project.update({
            where: { id },
            data: {
                name: data.name,
                businessNumber: data.businessNumber || null,
                type: (data.type ?? "AUTRE") as never,
                status: data.status as never,
                power: data.power ?? null,
                budget: data.budget ?? null,
                address: data.address || null,
                startDate: data.startDate ? new Date(data.startDate) : null,
                endDate: data.endDate ? new Date(data.endDate) : null,
                notes: data.notes || null,
            },
        });
        return project;
    } catch (error) {
        console.log("Repository update project error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error updating project.",
        };
    }
}

export type ReserveStatusStyleData = {
    openLabel: string | null;
    openColor: string | null;
    resolvedLabel: string | null;
    resolvedColor: string | null;
};

/**
 * Persists this project's OPEN/RESOLVED réserve status presentation. A null
 * field means "not configured, use the product default" — see the Project
 * model doc and migration 20260823090000. The database CHECK constraints are
 * the backstop for anything Zod already rejected upstream (actions/reserves).
 *
 * Explicit `select` (not the bare updated row): Project also carries
 * `budget`/`notes`, deliberately never returned to callers that only need to
 * confirm this narrower write succeeded.
 */
export async function updateReserveStatusStyle(id: number, data: ReserveStatusStyleData) {
    try {
        return await prisma.project.update({
            where: { id },
            data: {
                reserveOpenLabel: data.openLabel,
                reserveOpenColor: data.openColor,
                reserveResolvedLabel: data.resolvedLabel,
                reserveResolvedColor: data.resolvedColor,
            },
            select: {
                id: true,
                reserveOpenLabel: true,
                reserveOpenColor: true,
                reserveResolvedLabel: true,
                reserveResolvedColor: true,
            },
        });
    } catch (error) {
        console.log("Repository updateReserveStatusStyle (project) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error updating project reserve status style.",
        };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.project.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove project error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error deleting project.",
        };
    }
}

/** Move a project to the trash (reversible). */
export async function softDelete(id: number) {
    try {
        return await prisma.project.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
    } catch (error) {
        console.log("Repository softDelete project error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error deleting project.",
        };
    }
}

/** Bring a trashed project back into the normal listings. */
export async function restore(id: number) {
    try {
        return await prisma.project.update({
            where: { id },
            data: { deletedAt: null },
        });
    } catch (error) {
        console.log("Repository restore project error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error restoring project.",
        };
    }
}

/**
 * Trashed projects (most recently deleted first), optionally scoped to the
 * given ids (pass
 * `projectIdFilter(await getAccessContext())` — `undefined` means
 * unrestricted, matching `search`'s convention). A restricted caller must
 * only see the deleted projects they were assigned to, not the whole
 * instance's trash.
 */
export async function findTrashed(projectIds?: number[]) {
    try {
        return await prisma.project.findMany({
            where: {
                deletedAt: { not: null },
                ...(projectIds !== undefined ? { id: { in: projectIds } } : {}),
            },
            include: {
                client: { select: { id: true, companyName: true } },
            },
            orderBy: { deletedAt: "desc" },
        });
    } catch (error) {
        console.log("Repository findTrashed project error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching trashed projects.",
        };
    }
}

/** Per-status counts, e.g. for the client detail page or a dashboard widget. */
export async function countByStatus(clientId?: number) {
    try {
        const grouped = await prisma.project.groupBy({
            by: ["status"],
            where: clientId ? { clientId } : undefined,
            _count: { _all: true },
        });
        const byStatus: Record<string, number> = {
            ETUDE: 0, SIGNE: 0, EN_COURS: 0, RACCORDEMENT: 0, TERMINE: 0, ANNULE: 0,
        };
        for (const g of grouped) byStatus[g.status] = g._count._all;
        return byStatus;
    } catch (error) {
        console.log("Repository countByStatus error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error counting projects.",
        };
    }
}

/** Every live project with its company name — the picker used to assign users. */
export async function findAllAssignable() {
    try {
        const projects = await prisma.project.findMany({
            where: { deletedAt: null, client: { deletedAt: null } },
            select: { id: true, name: true, client: { select: { companyName: true } } },
            orderBy: [{ client: { companyName: "asc" } }, { name: "asc" }],
        });
        return projects.map((p) => ({ id: p.id, name: p.name, companyName: p.client.companyName }));
    } catch (error) {
        console.log("Repository findAllAssignable error:", error);
        throw { type: "repositoryError", message: "Database Error fetching projects." };
    }
}
