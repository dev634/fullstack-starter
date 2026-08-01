import { prisma } from "@/lib/prisma";
import { type Client, Prisma } from "@/app/generated/prisma/client";
import { GetClientsByOrder } from "@/service/clients";



/**
 * Aggregate figures for the home dashboard: total, per-status counts and the
 * most recently added clients (id desc, since there is no createdAt column).
 */
export async function getDashboardStats() {
    try {
        const [total, grouped, recent] = await Promise.all([
            prisma.client.count({ where: { deletedAt: null } }),
            prisma.client.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
            prisma.client.findMany({ where: { deletedAt: null }, orderBy: { id: "desc" }, take: 5 }),
        ]);
        const byStatus: Record<string, number> = { PROSPECT: 0, CLIENT: 0, INACTIVE: 0 };
        for (const g of grouped) byStatus[g.status] = g._count._all;
        return { total, byStatus, recent };
    } catch (error) {
        console.log("Repository getDashboardStats error:", error);
        throw {
            type: "error",
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
            type: "error",
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
      type: "error",
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
            type: "error",
            message: "Database Error fetching clients."
           }
    }
}

/** Soft-deleted clients (trash), most recently deleted first. */
export async function findTrashed() {
    try {
        const clients = await prisma.client.findMany({
            where: { deletedAt: { not: null } },
            orderBy: { deletedAt: "desc" },
        });
        return clients;
    } catch (error) {
        console.log("Repository findTrashed error:", error);
        throw {
            type: "error",
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
            type: "error",
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
            type: "error",
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
            type: "error",
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
            type: "error",
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
            type: "error",
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
            type: "error",
            message: "Database Error deleting client"
        }
    }
}
