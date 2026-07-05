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

export async function listActivity(page = 1) {
  try {
    const [entries, total] = await Promise.all([
      prisma.activityLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.activityLog.count(),
    ]);
    return { entries, total, pageSize: PAGE_SIZE };
  } catch (error) {
    console.log("Repository listActivity error:", error);
    throw {
      type: "error",
      message: "Database Error fetching activity log.",
    };
  }
}
