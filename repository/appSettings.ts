import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

// Two writers, two disjoint sets of columns (F7): the branding form writes the name
// and the colors and NEVER the logo; the logo upload / removal writes the logo
// columns and NOTHING else. Each used to carry the other's values, read a moment
// earlier (`current.logoUrl`, `current.appName`): two concurrent requests then
// overwrote each other's change with a stale copy. With disjoint columns, whichever
// commits last cannot undo the other.
type BrandingUpdate = {
    appName: string;
    primaryColor: string;
    accentColor: string;
    updatedBy: string;
};

type LogoUpdate = {
    logoUrl: string | null;
    logoPublicId: string | null;
    updatedBy: string;
};

/** The one singleton settings row (id=1), seeded by the migration. */
export async function getSettings() {
    try {
        return await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
    } catch (error) {
        console.log("Repository getSettings error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching app settings.",
        };
    }
}

/** Writes the branding (name and colors); the logo columns are not part of it and stay as they are. */
export async function upsert(data: BrandingUpdate) {
    try {
        return await prisma.appSettings.upsert({
            where: { id: 1 },
            // Field by field, not `update: data`: a whole parameter handed to
            // Prisma is a write nobody can read (tests/repository-partial-write.test.ts).
            update: {
                appName: data.appName,
                primaryColor: data.primaryColor,
                accentColor: data.accentColor,
                updatedBy: data.updatedBy,
            },
            create: { id: 1, ...data },
        });
    } catch (error) {
        console.log("Repository upsert (appSettings) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error updating app settings.",
        };
    }
}

/**
 * Writes the logo columns, and only them (null clears). The settings row is seeded
 * (id=1), so a plain update is sufficient, as for the access matrix below.
 */
export async function updateLogo(data: LogoUpdate) {
    try {
        return await prisma.appSettings.update({
            where: { id: 1 },
            data: {
                logoUrl: data.logoUrl,
                logoPublicId: data.logoPublicId,
                updatedBy: data.updatedBy,
            },
        });
    } catch (error) {
        console.log("Repository updateLogo (appSettings) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error updating the logo.",
        };
    }
}

/**
 * Whether a branding row still points at this Cloudinary asset: the question an
 * upload compensation (lib/uploadCompensation.ts) asks before destroying a file
 * after a failed write that may have committed anyway. Only existence is read.
 * A failure is thrown, not answered "no": the caller keeps the asset when it
 * cannot tell.
 */
export async function isLogoPublicIdReferenced(publicId: string): Promise<boolean> {
    try {
        const row = await prisma.appSettings.findFirst({
            where: { logoPublicId: publicId },
            select: { id: true },
        });
        return row !== null;
    } catch (error) {
        console.log("Repository isLogoPublicIdReferenced error:", error);
        throw { type: "repositoryError", message: "Database Error fetching app settings." };
    }
}

/**
 * Persists the RBAC matrix (capability -> min role) as JSON — kept separate
 * from the branding upsert so the two concerns don't clobber each other. The
 * value is already resolved/validated (lib/capabilities) before it gets here.
 */
export async function updateAccessConfig(accessConfig: Prisma.InputJsonValue, updatedBy: string) {
    try {
        return await prisma.appSettings.update({
            where: { id: 1 },
            data: { accessConfig, updatedBy },
        });
    } catch (error) {
        console.log("Repository updateAccessConfig (appSettings) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error updating access config.",
        };
    }
}

/**
 * Updates only the project section display order — kept separate from the
 * branding upsert so the two concerns don't clobber each other's fields.
 * The settings row is seeded (id=1), so a plain update is sufficient.
 */
export async function updateSectionOrder(order: string[], updatedBy: string) {
    try {
        return await prisma.appSettings.update({
            where: { id: 1 },
            data: { projectSectionOrder: order, updatedBy },
        });
    } catch (error) {
        console.log("Repository updateSectionOrder (appSettings) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error updating section order.",
        };
    }
}
