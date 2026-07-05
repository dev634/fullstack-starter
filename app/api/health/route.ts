import { prisma } from "@/lib/prisma";

/**
 * Public health-check endpoint for uptime monitors (e.g. UptimeRobot) and
 * container orchestration. Not behind auth — see proxy.ts's matcher.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok", timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Health check failed:", error);
    return Response.json(
      { status: "error", db: "unreachable", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
