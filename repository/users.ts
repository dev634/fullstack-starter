import { prisma } from "@/lib/prisma";
import { Prisma, type Role } from "@/app/generated/prisma/client";

/** All app users (without password hashes), for the management screen. */
export async function findAll() {
    try {
        return await prisma.user.findMany({
            select: { id: true, email: true, name: true, role: true, createdAt: true },
            orderBy: { createdAt: "asc" },
        });
    } catch (error) {
        console.log("Repository findAll (user) error:", error);
        throw { type: "error", message: "Database Error fetching users." };
    }
}

export async function findById(id: number) {
    try {
        return await prisma.user.findUnique({ where: { id } });
    } catch (error) {
        console.log("Repository findById (user) error:", error);
        throw { type: "error", message: "Database Error fetching user." };
    }
}

export async function create(data: { email: string; name: string | null; role: Role; password: string }) {
    try {
        return await prisma.user.create({
            data,
            select: { id: true, email: true, name: true, role: true, createdAt: true },
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw { type: "duplicate", message: "A user with this email already exists." };
        }
        console.log("Repository create (user) error:", error);
        throw { type: "error", message: "Database Error creating user." };
    }
}

export async function updateProfile(id: number, data: { name: string | null; role: Role }) {
    try {
        return await prisma.user.update({
            where: { id },
            data,
            select: { id: true, email: true, name: true, role: true, createdAt: true },
        });
    } catch (error) {
        console.log("Repository updateProfile (user) error:", error);
        throw { type: "error", message: "Database Error updating user." };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.user.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove (user) error:", error);
        throw { type: "error", message: "Database Error deleting user." };
    }
}

/** How many SUPERADMIN accounts exist — guards against removing the last one. */
export async function countSuperadmins() {
    try {
        return await prisma.user.count({ where: { role: "SUPERADMIN" } });
    } catch (error) {
        console.log("Repository countSuperadmins error:", error);
        throw { type: "error", message: "Database Error counting admins." };
    }
}

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
