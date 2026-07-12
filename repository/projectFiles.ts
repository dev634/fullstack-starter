import { prisma } from "@/lib/prisma";

type FileData = {
    projectId: number;
    folderId?: number | null;
    name: string;
    url: string;
    publicId: string;
    size?: number;
    mimeType?: string;
};

export async function create(data: FileData) {
    try {
        return await prisma.projectFile.create({
            data: {
                projectId: data.projectId,
                folderId: data.folderId ?? null,
                name: data.name,
                url: data.url,
                publicId: data.publicId,
                size: data.size ?? null,
                mimeType: data.mimeType ?? null,
            },
        });
    } catch (error) {
        console.log("Repository create file error:", error);
        throw {
            type: "error",
            message: "Database Error creating file.",
        };
    }
}

/** Files directly inside a folder, or at the project root when `folderId` is null. */
export async function findByFolder(projectId: number, folderId: number | null) {
    try {
        return await prisma.projectFile.findMany({
            where: { projectId, folderId },
            orderBy: { name: "asc" },
        });
    } catch (error) {
        console.log("Repository findByFolder (file) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching files.",
        };
    }
}

export async function findById(id: number) {
    try {
        return await prisma.projectFile.findUnique({ where: { id } });
    } catch (error) {
        console.log("Repository findById (file) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching file.",
        };
    }
}

export async function remove(id: number) {
    try {
        return await prisma.projectFile.delete({ where: { id } });
    } catch (error) {
        console.log("Repository remove file error:", error);
        throw {
            type: "error",
            message: "Database Error deleting file.",
        };
    }
}
