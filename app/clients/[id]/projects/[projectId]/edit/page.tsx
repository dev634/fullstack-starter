import { getProject } from "@/actions/projects/projects";
import { auth } from "@/lib/auth";
import { can } from "@/lib/access";
import Title from "@/components/Title";
import UpdateProjectForm from "@/forms/UpdateProjectForm";
import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

type PageProps = {
    params: Promise<{
        id: string;
        projectId: string;
    }>;
};

export default async function EditProjectPage({ params }: PageProps) {
    const session = await auth();
    if (!(await can(session?.user?.role, "content.edit"))) {
        redirect("/clients");
    }

    const { id, projectId } = await params;
    const result = await getProject(parseInt(projectId, 10));
    const isError = result.type === "error";
    const isEmpty = result.type === "success" && !result.data;
    const t = getDictionary(await getLocale());

    if (isError) {
        return <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
                    <Title title={t.projects.editSubmit} />
                    <p className="text-red-500">{result.message}</p>
               </main>
    }

    if (isEmpty || result.data?.clientId !== parseInt(id, 10)) {
        return <main className="flex flex-1 min-h-0 flex-col justify-center items-center overflow-y-auto py-8">
                    <Title title={t.projects.editSubmit} />
                    <p>{t.projects.detail.notFound}</p>
               </main>
    }

    return (
        <main className="flex flex-1 min-h-0 flex-col justify-start items-center overflow-y-auto px-6 py-8">
            <div className="w-full max-w-2xl">
                <Title title={t.projects.editSubmit} />
                <UpdateProjectForm
                    project={{
                        id: result.data!.id,
                        clientId: result.data!.clientId,
                        name: result.data!.name,
                        businessNumber: result.data!.businessNumber,
                        type: result.data!.type,
                        status: result.data!.status,
                        power: result.data!.power,
                        budget: result.data!.budget,
                        address: result.data!.address,
                        startDate: result.data!.startDate,
                        endDate: result.data!.endDate,
                        notes: result.data!.notes,
                    }}
                />
            </div>
        </main>
    );
}
