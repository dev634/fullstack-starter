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
            prisma.client.count(),
            prisma.client.groupBy({ by: ["status"], _count: { _all: true } }),
            prisma.client.findMany({ orderBy: { id: "desc" }, take: 5 }),
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

export async function create({firstName, lastName, email, companyName, address, city, zipCode, country, photoUrl, phone, website, status}: Omit<Client, "id">) {
    try {
        const clients = await prisma.client.create({
            data: {
                firstName,
                lastName,
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

export type ClientSortField = "firstName" | "lastName" | "companyName" | "email";

type SearchArgs = {
  q?: string;
  sortField?: ClientSortField;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

/**
 * Paginated, filterable client listing. `q` matches (case-insensitively)
 * against name, company and email. Returns the page of rows and the total
 * count for pagination.
 */
export async function search({
  q = "",
  sortField = "firstName",
  dir = "asc",
  page = 1,
  pageSize = 9,
}: SearchArgs) {
  const term = q.trim();
  const where: Prisma.ClientWhereInput = term
    ? {
        OR: [
          { firstName: { contains: term, mode: Prisma.QueryMode.insensitive } },
          { lastName: { contains: term, mode: Prisma.QueryMode.insensitive } },
          { companyName: { contains: term, mode: Prisma.QueryMode.insensitive } },
          { email: { contains: term, mode: Prisma.QueryMode.insensitive } },
        ],
      }
    : {};

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
        const clients = await prisma.client.findMany({orderBy: orderBy || { id: "asc" }});
        return clients;
    } catch (error) {
        console.log("Repository findAll error:", error);
        throw {
            type: "error",
            message: "Database Error fetching clients."
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

export async function update({ id, firstName, lastName, email, companyName, address, city, zipCode, country, phone, website, status, photoUrl }: Omit<Client, "photoUrl"> & { photoUrl?: string | null }) {
    try{
        const client = await prisma.client.update({
            where: { id },
            data: {
                firstName, lastName, email, companyName, address, city, zipCode, country,
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

export async function remove(id: number) {
    try{
    const client = await prisma.client.delete({
        where: { id },
    });
    return client;
    }catch(error){
        console.log("Repository delete error:", error);
        throw {
            type: "error",
            message: "Database Error deleting client"
        }
    }
}   