import { prisma } from "@/lib/prisma";

/**
 * Public health-check endpoint for uptime monitors (e.g. UptimeRobot) and
 * container orchestration. Not behind auth — see proxy.ts's matcher.
 *
 * `version` is the short git commit the running image was built from (baked in
 * via the GIT_SHA build-arg — see Dockerfile), so `curl /api/health` tells you
 * exactly which commit/PR is live.
 */
const version = (process.env.GIT_SHA ?? "unknown").slice(0, 7);

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    // How many ProjectFile/ReservePlan/ReservePhoto rows still point at a
    // publicly-reachable Cloudinary asset (deliveryType = 'UPLOAD') — i.e.
    // whether scripts/retype-existing-guarded-assets.mjs has finished. A
    // single aggregate count, on purpose: this route is public, so no
    // per-model breakdown or row-level detail — just enough to tell "not run
    // yet" apart from "done".
    const [pendingFiles, pendingPlans, pendingPhotos] = await Promise.all([
      prisma.projectFile.count({ where: { deliveryType: "UPLOAD" } }),
      prisma.reservePlan.count({ where: { deliveryType: "UPLOAD" } }),
      prisma.reservePhoto.count({ where: { deliveryType: "UPLOAD" } }),
    ]);
    return Response.json({
      status: "ok",
      db: "ok",
      version,
      timestamp: new Date().toISOString(),
      pendingGuardedAssets: pendingFiles + pendingPlans + pendingPhotos,
    });
  } catch (error) {
    console.error("Health check failed:", error);
    return Response.json(
      { status: "error", db: "unreachable", version, timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
