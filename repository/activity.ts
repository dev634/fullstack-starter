import { prisma } from "@/lib/prisma";
import type { ActivityAction } from "@/app/generated/prisma/client";

type LogActivityArgs = {
  action: ActivityAction;
  clientId: number | null;
  clientName: string;
  actorEmail: string;
};

/**
 * Record a client mutation for the audit trail. Never throws — a logging
 * failure must not break the mutation it's describing.
 */
export async function logActivity(args: LogActivityArgs): Promise<void> {
  try {
    await prisma.activityLog.create({ data: args });
  } catch (error) {
    console.error("Repository logActivity error:", error);
  }
}

const PAGE_SIZE = 20;

/**
 * Paginated activity log, optionally scoped to the given client ids (pass
 * `repository/projects.ts::findClientIdsAmong(projectIdFilter(ctx))` —
 * `undefined` means unrestricted, matching the rest of the app's scoping
 * convention). Without this, every entry in the instance — including the
 * actor's email on each — was visible to any caller with the activity
 * capability, regardless of which projects/clients their job function
 * restricts them to.
 */
export async function listActivity(page = 1, clientIds?: number[]) {
  try {
    const where = clientIds !== undefined ? { clientId: { in: clientIds } } : undefined;
    const [entries, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.activityLog.count({ where }),
    ]);
    return { entries, total, pageSize: PAGE_SIZE };
  } catch (error) {
    console.log("Repository listActivity error:", error);
    throw {
      type: "repositoryError",
      message: "Database Error fetching activity log.",
    };
  }
}
