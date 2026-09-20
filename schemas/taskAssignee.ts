// The assignee picker submits a single field encoding what's assigned: ""
// (none), "company:<id>" (a subcontractor company), "interim:<id>" (an
// intérimaire), or "worker:<id>" (an internal employee attached to the
// project via ProjectWorker) — same one-field encoding as the material link
// picker, since the three assignee kinds are mutually exclusive by
// construction (enforced by the `*_one_assignee_check` CHECK, migration
// 20260920100000_project_workers).
export type ParsedAssignee = {
    assignedCompanyId: number | null;
    assignedInterimId: number | null;
    assignedWorkerId: number | null;
};

export function parseAssignee(value: string | null | undefined): ParsedAssignee {
    const empty: ParsedAssignee = { assignedCompanyId: null, assignedInterimId: null, assignedWorkerId: null };
    const [kind, idStr] = (value ?? "").split(":");
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return empty;
    if (kind === "company") return { assignedCompanyId: id, assignedInterimId: null, assignedWorkerId: null };
    if (kind === "interim") return { assignedCompanyId: null, assignedInterimId: id, assignedWorkerId: null };
    if (kind === "worker") return { assignedCompanyId: null, assignedInterimId: null, assignedWorkerId: id };
    return empty;
}

export const ASSIGNEE_TARGET_KINDS = ["task", "group", "category"] as const;
export type AssigneeTargetKind = (typeof ASSIGNEE_TARGET_KINDS)[number];
