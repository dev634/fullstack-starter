import { prisma } from "@/lib/prisma";

export async function findByEmail(email: string) {
    try {
        const user = await prisma.user.findUnique({
            where: { email },
        });
        return user;
    } catch (error) {
        console.log("Repository findByEmail error:", error);
        throw {
            type: "error",
            message: "Database Error fetching user."
        };
    }
}

/**
 * Issue a fresh password-reset token for a user, discarding any earlier
 * unused ones so a user only ever has one valid link at a time.
 */
export async function createResetToken(userId: number, token: string, expiresAt: Date) {
    try {
        await prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
        return await prisma.passwordResetToken.create({
            data: { userId, token, expiresAt },
        });
    } catch (error) {
        console.log("Repository createResetToken error:", error);
        throw {
            type: "error",
            message: "Database Error creating reset token."
        };
    }
}

/** A token that hasn't been used yet and hasn't expired, with its user. */
export async function findValidResetToken(token: string) {
    try {
        return await prisma.passwordResetToken.findFirst({
            where: { token, usedAt: null, expiresAt: { gt: new Date() } },
            include: { user: true },
        });
    } catch (error) {
        console.log("Repository findValidResetToken error:", error);
        throw {
            type: "error",
            message: "Database Error fetching reset token."
        };
    }
}

export async function markResetTokenUsed(id: number) {
    try {
        return await prisma.passwordResetToken.update({
            where: { id },
            data: { usedAt: new Date() },
        });
    } catch (error) {
        console.log("Repository markResetTokenUsed error:", error);
        throw {
            type: "error",
            message: "Database Error updating reset token."
        };
    }
}

export async function updatePassword(userId: number, hashedPassword: string) {
    try {
        return await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword },
        });
    } catch (error) {
        console.log("Repository updatePassword error:", error);
        throw {
            type: "error",
            message: "Database Error updating password."
        };
    }
}
