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
