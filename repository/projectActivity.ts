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

/**
 * Paginated activity log, optionally scoped to the given project ids (pass
 * `projectIdFilter(await getAccessContext())` — `undefined` means
 * unrestricted, matching `search`'s convention). Without this, every entry
 * in the instance — including the actor's email on each — was visible to
 * any caller with the activity capability, regardless of the projects their
 * job function restricts them to. A bulk-import entry (`projectId: null`)
 * isn't tied to a specific project, so it's excluded for a restricted
 * caller rather than guessed at.
 */
export async function listActivity(page = 1, projectIds?: number[]) {
  try {
    const where = projectIds !== undefined ? { projectId: { in: projectIds } } : undefined;
    const [entries, total] = await Promise.all([
      prisma.projectActivityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.projectActivityLog.count({ where }),
    ]);
    return { entries, total, pageSize: PAGE_SIZE };
  } catch (error) {
    console.log("Repository listActivity (project) error:", error);
    throw {
      type: "repositoryError",
      message: "Database Error fetching activity log.",
    };
  }
}
