import { prisma } from "@/lib/prisma";

/** Count of attempts for `key` within the last `windowMs`, plus the oldest one's timestamp (to compute a retry-after). */
export async function getRecentAttempts(
    key: string,
    windowMs: number
): Promise<{ count: number; oldestAt: Date | null }> {
    try {
        const since = new Date(Date.now() - windowMs);
        const rows = await prisma.rateLimitAttempt.findMany({
            where: { key, createdAt: { gte: since } },
            orderBy: { createdAt: "asc" },
            select: { createdAt: true },
        });
        return { count: rows.length, oldestAt: rows[0]?.createdAt ?? null };
    } catch (error) {
        console.log("Repository getRecentAttempts (rateLimit) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error checking rate limit.",
        };
    }
}

/**
 * Record a failed attempt. Opportunistically prunes attempts for this key
 * older than a day first, so the table doesn't grow unbounded without
 * needing a separate cleanup job.
 */
export async function recordAttempt(key: string): Promise<void> {
    try {
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await prisma.$transaction([
            prisma.rateLimitAttempt.deleteMany({ where: { key, createdAt: { lt: dayAgo } } }),
            prisma.rateLimitAttempt.create({ data: { key } }),
        ]);
    } catch (error) {
        console.log("Repository recordAttempt (rateLimit) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error recording rate limit attempt.",
        };
    }
}

/** Clear every attempt for a key (e.g. on a successful login). */
export async function clearAttempts(key: string): Promise<void> {
    try {
        await prisma.rateLimitAttempt.deleteMany({ where: { key } });
    } catch (error) {
        console.log("Repository clearAttempts (rateLimit) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error clearing rate limit.",
        };
    }
}
