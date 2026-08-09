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
            type: "repositoryError",
            message: "Database Error creating subcontractor company.",
        };
    }
}

/** Subcontractor companies for a project, oldest first, with their personnel (and each person's job function) included. */
export async function findCompaniesByProject(projectId: number) {
    try {
        return await prisma.subcontractorCompany.findMany({
            where: { projectId },
            include: {
                personnel: {
                    orderBy: { createdAt: "asc" },
                    include: { jobFunction: { select: { id: true, name: true } } },
                },
            },
            orderBy: { createdAt: "asc" },
        });
    } catch (error) {
        console.log("Repository findCompaniesByProject (subcontractor) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error fetching subcontractor companies.",
        };
    }
}

/** The company's real project id, or null if it doesn't exist — see repository/tasks.ts::findProjectId. */
export async function findCompanyProjectId(id: number): Promise<number | null> {
    try {
        const company = await prisma.subcontractorCompany.findUnique({ where: { id }, select: { projectId: true } });
        return company?.projectId ?? null;
    } catch (error) {
        console.log("Repository findCompanyProjectId (subcontractor) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching subcontractor company." };
    }
}

/**
 * A person's real project id (via its company — SubcontractorPerson has no
 * projectId column of its own), or null if it doesn't exist.
 */
export async function findPersonProjectId(id: number): Promise<number | null> {
    try {
        const person = await prisma.subcontractorPerson.findUnique({
            where: { id },
            select: { company: { select: { projectId: true } } },
        });
        return person?.company.projectId ?? null;
    } catch (error) {
        console.log("Repository findPersonProjectId (subcontractor) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching subcontractor personnel." };
    }
}

/** Deletes the company and, via cascade, every person under it. */
export async function removeCompany(id: number) {
    try {
        return await prisma.subcontractorCompany.delete({ where: { id } });
    } catch (error) {
        console.log("Repository removeCompany (subcontractor) error:", error);
        throw {
            type: "repositoryError",
            message: "Database Error deleting subcontractor company.",
        };
    }
}

type PersonData = {
    companyId: number;
    name: string;
    jobFunctionId?: number | null;
    phone?: string;
};

export async function addPerson(data: PersonData) {
    try {
        return await prisma.subcontractorPerson.create({
            data: {
                companyId: data.companyId,
                name: data.name,
                jobFunctionId: data.jobFunctionId ?? null,
                phone: data.phone || null,
            },
        });
    } catch (error) {
        console.log("Repository addPerson (subcontractor) error:", error);
        throw {
            type: "repositoryError",
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
            type: "repositoryError",
            message: "Database Error deleting subcontractor personnel.",
        };
    }
}
