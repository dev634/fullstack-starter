import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

type SettingsUpdate = {
    appName: string;
    logoUrl?: string | null;
    logoPublicId?: string | null;
    primaryColor: string;
    accentColor: string;
    updatedBy: string;
};

/** The one singleton settings row (id=1), seeded by the migration. */
export async function getSettings() {
    try {
        return await prisma.appSettings.findUniqueOrThrow({ where: { id: 1 } });
    } catch (error) {
        console.log("Repository getSettings error:", error);
        throw {
            type: "error",
            message: "Database Error fetching app settings.",
        };
    }
}

export async function upsert(data: SettingsUpdate) {
    try {
        return await prisma.appSettings.upsert({
            where: { id: 1 },
            update: data,
            create: { id: 1, ...data },
        });
    } catch (error) {
        console.log("Repository upsert (appSettings) error:", error);
        throw {
            type: "error",
            message: "Database Error updating app settings.",
        };
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
            type: "error",
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
            type: "error",
            message: "Database Error updating section order.",
        };
    }
}
