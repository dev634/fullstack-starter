import { prisma } from "@/lib/prisma";
import type { ActivityAction } from "@/app/generated/prisma/client";

type LogActivityArgs = {
  action: ActivityAction;
  projectId: number | null;
  projectName: string;
  actorEmail: string;
};

/**
 * Record a project mutation for the audit trail. Never throws — a logging
 * failure must not break the mutation it's describing.
 */
export async function logActivity(args: LogActivityArgs): Promise<void> {
  try {
    await prisma.projectActivityLog.create({ data: args });
  } catch (error) {
    console.error("Repository logActivity (project) error:", error);
  }
}

const PAGE_SIZE = 20;

export async function listActivity(page = 1) {
  try {
    const [entries, total] = await Promise.all([
      prisma.projectActivityLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.projectActivityLog.count(),
    ]);
    return { entries, total, pageSize: PAGE_SIZE };
  } catch (error) {
    console.log("Repository listActivity (project) error:", error);
    throw {
      type: "error",
      message: "Database Error fetching activity log.",
    };
  }
}
