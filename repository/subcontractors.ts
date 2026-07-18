import { prisma } from "@/lib/prisma";

type CompanyData = {
    projectId: number;
    name: string;
};

export async function createCompany(data: CompanyData) {
    try {
        return await prisma.subcontractorCompany.create({
            data: {
                projectId: data.projectId,
                name: data.name,
            },
        });
    } catch (error) {
        console.log("Repository createCompany (subcontractor) error:", error);
        throw {
            type: "error",
            message: "Database Error creating subcontractor company.",
        };
    }
}

/** Subcontractor companies for a project, oldest first, with their personnel included. */
export async function findCompaniesByProject(projectId: number) {
    try {
        return await prisma.subcontractorCompany.findMany({
            where: { projectId },
            include: { personnel: { orderBy: { createdAt: "asc" } } },
            orderBy: { createdAt: "asc" },
        });
    } catch (error) {
        console.log("Repository findCompaniesByProject (subcontractor) error:", error);
        throw {
            type: "error",
            message: "Database Error fetching subcontractor companies.",
        };
    }
}

/** Deletes the company and, via cascade, every person under it. */
export async function removeCompany(id: number) {
    try {
        return await prisma.subcontractorCompany.delete({ where: { id } });
    } catch (error) {
        console.log("Repository removeCompany (subcontractor) error:", error);
        throw {
            type: "error",
            message: "Database Error deleting subcontractor company.",
        };
    }
}

type PersonData = {
    companyId: number;
    name: string;
    role?: string;
    phone?: string;
};

export async function addPerson(data: PersonData) {
    try {
        return await prisma.subcontractorPerson.create({
            data: {
                companyId: data.companyId,
                name: data.name,
                role: data.role || null,
                phone: data.phone || null,
            },
        });
    } catch (error) {
        console.log("Repository addPerson (subcontractor) error:", error);
        throw {
            type: "error",
            message: "Database Error adding subcontractor personnel.",
        };
    }
}

export async function removePerson(id: number) {
    try {
        return await prisma.subcontractorPerson.delete({ where: { id } });
    } catch (error) {
        console.log("Repository removePerson (subcontractor) error:", error);
        throw {
            type: "error",
            message: "Database Error deleting subcontractor personnel.",
        };
    }
}
