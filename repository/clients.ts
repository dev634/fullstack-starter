import { prisma } from "@/lib/prisma";
import { type Client, Prisma } from "@/app/generated/prisma/client";
import { GetClientsByOrder } from "@/service/clients";



/**
 * Aggregate figures for the home dashboard: total, per-status counts and the
 * most recently added clients (id desc, since there is no createdAt column).
 *
 * Optionally scoped to `projectIds` (pass `projectIdFilter(await
 * getAccessContext())` — `undefined` means unrestricted, matching `search`'s
 * convention): without this, every counter and "recently added" row covered
 * the whole instance regardless of the caller's assigned projects. `select`
 * is explicit on `recent` (not the full row) since Client carries an email —
 * project convention for any model with a sensitive-ish field.
 */
export async function getDashboardStats(projectIds?: number[]) {
    try {
        const where: Prisma.ClientWhereInput = {
            deletedAt: null,
            ...(projectIds !== undefined
                ? { projects: { some: { id: { in: projectIds }, deletedAt: null } } }
                : {}),
        };
        const [total, grouped, recent] = await Promise.all([
            prisma.client.count({ where }),
            prisma.client.groupBy({ by: ["status"], where, _count: { _all: true } }),
            prisma.client.findMany({
                where,
                orderBy: { id: "desc" },
                take: 5,
                select: { id: true, companyName: true, email: true, photoUrl: true, status: true },
            }),
        ]);
        const byStatus: Record<string, number> = { PROSPECT: 0, CLIENT: 0, INACTIVE: 0 };
        for (const g of grouped) byStatus[g.status] = g._count._all;
        return { total, byStatus, recent };
    } catch (error) {
        console.log("Repository getDashboardStats error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error loading dashboard.",
        };
    }
}

export async function create({email, companyName, address, city, zipCode, country, photoUrl, phone, website, status}: Omit<Client, "id" | "deletedAt">) {
    try {
        const clients = await prisma.client.create({
            data: {
                email,
                companyName,
                address,
                city,
                zipCode,
                country,
                photoUrl,
                phone,
                website,
                status
            }
        });
        return clients;
    } catch (error) {
        if(error instanceof Prisma.PrismaClientKnownRequestError ) {
            if (error.code === "P2002") {
                throw {
                    type: "databaseError",
                    message: "A client with this email already exists. Please use a different email."
                }
            }
        }
        
        throw {
            type: "repositoryError",
            message: "Database Error creating client."
        };
    }
}

export type ClientSortField = "companyName" | "email" | "city";

type SearchArgs = {
  q?: string;
  sortField?: ClientSortField;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

/**
 * Paginated, filterable organisation listing. `q` matches (case-insensitively)
 * against company name, email and city — and against the name/email of any
 * of the organisation's contacts. Returns the page of rows and the total
 * count for pagination.
 */
export async function search({
  q = "",
  sortField = "companyName",
  dir = "asc",
  page = 1,
  pageSize = 9,
  projectIds,
}: SearchArgs & { projectIds?: number[] }) {
  const term = q.trim();
  const insensitive = Prisma.QueryMode.insensitive;
  const where: Prisma.ClientWhereInput = {
    deletedAt: null,
    // A restricted user reaches a company only through a project they hold, so
    // an EMPTY allowlist must yield no company at all. Hence a presence check
    // on the parameter, never a truthiness one.
    ...(projectIds !== undefined
      ? { projects: { some: { id: { in: projectIds }, deletedAt: null } } }
      : {}),
    ...(term
      ? {
          OR: [
            { companyName: { contains: term, mode: insensitive } },
            { email: { contains: term, mode: insensitive } },
            { city: { contains: term, mode: insensitive } },
            {
              contacts: {
                some: {
                  OR: [
                    { firstName: { contains: term, mode: insensitive } },
                    { lastName: { contains: term, mode: insensitive } },
                    { email: { contains: term, mode: insensitive } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };

  try {
    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { [sortField]: dir } as Prisma.ClientOrderByWithRelationInput,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.client.count({ where }),
    ]);
    return { clients, total };
  } catch (error) {
    console.log("Repository search error:", error);
    throw {
      type: "repositoryError",
      message: "Database Error searching clients.",
    };
  }
}

export async function findAll(orderBy: GetClientsByOrder) {
    try {
        const clients = await prisma.client.findMany({
            where: { deletedAt: null },
            orderBy: orderBy || { id: "asc" },
        });
        return clients;
    } catch (error) {
        console.log("Repository findAll error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching clients."
           }
    }
}

/**
 * Trashed companies (most recently deleted first), optionally scoped to the
 * given project ids (pass
 * `projectIdFilter(await getAccessContext())` — `undefined` means
 * unrestricted, matching `search`'s convention).
 *
 * A company itself has no project-scoped id to filter on, so — mirroring
 * `search`'s `projects: { some: { ... } }` clause and the `hasProjectAmong`
 * check that already gates restore/permanent-delete — a restricted caller
 * only sees a trashed company here if it still owns a *live* project among
 * their assigned ids. Trashing a company doesn't cascade to its projects, so
 * that project can still exist (deletedAt: null) even though its owner is
 * now in the trash; a restricted user assigned to that project keeps the
 * same "can reach this company" relationship the mutations already grant
 * them, so the listing that surfaces the restore/delete buttons must show
 * the same row. Anyone with no live project left in their assigned set sees
 * nothing here, which is the common case.
 *
 * `select` is explicit (not the full row) since Client carries an email —
 * project convention for any model with a sensitive-ish field.
 */
export async function findTrashed(projectIds?: number[]) {
    try {
        const clients = await prisma.client.findMany({
            where: {
                deletedAt: { not: null },
                ...(projectIds !== undefined
                    ? { projects: { some: { id: { in: projectIds }, deletedAt: null } } }
                    : {}),
            },
            orderBy: { deletedAt: "desc" },
            select: { id: true, companyName: true, email: true, photoUrl: true },
        });
        return clients;
    } catch (error) {
        console.log("Repository findTrashed error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching trashed clients."
           }
    }
}

export async function findByEmail(email: string) {
    try{
        const client = await prisma.client.findUnique({
             where: { email },
        });
        return client;
    }catch(error){
        console.log("Repository findByEmail error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching client."
           }
    }
}

export async function findById(id: number) {
    try{
        const client = await prisma.client.findUnique({
             where: { id },
        });
        return client;
    }catch(error){
        console.log("Repository findById error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching client."
           }
    }
}

export async function update({ id, email, companyName, address, city, zipCode, country, phone, website, status, photoUrl }: Omit<Client, "photoUrl" | "deletedAt"> & { photoUrl?: string | null }) {
    try{
        const client = await prisma.client.update({
            where: { id },
            data: {
                email, companyName, address, city, zipCode, country,
                phone, website, status,
                // Only touch the photo when a new one was provided, so editing
                // other fields doesn't wipe an existing photo.
                ...(photoUrl !== undefined ? { photoUrl } : {}),
            },
        });
        return client;
    }catch(error){
        console.log("Repository update error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error update client"
        }
    }
}

/** Move a client to the trash (reversible). */
export async function softDelete(id: number) {
    try{
    const client = await prisma.client.update({
        where: { id },
        data: { deletedAt: new Date() },
    });
    return client;
    }catch(error){
        console.log("Repository softDelete error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error deleting client"
        }
    }
}

/** Bring a trashed client back into the normal listings. */
export async function restore(id: number) {
    try{
    const client = await prisma.client.update({
        where: { id },
        data: { deletedAt: null },
    });
    return client;
    }catch(error){
        console.log("Repository restore error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error restoring client"
        }
    }
}

/** Permanently remove a client (only meant to be called from the trash). */
export async function permanentlyRemove(id: number) {
    try{
    const client = await prisma.client.delete({
        where: { id },
    });
    return client;
    }catch(error){
        console.log("Repository permanentlyRemove error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error deleting client"
        }
    }
}
