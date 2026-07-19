// The assignee picker submits a single field encoding what's assigned: ""
// (none), "company:<id>" (a subcontractor company), or "interim:<id>" (an
// intérimaire) — same one-field encoding as the material link picker, since
// the two assignee kinds are mutually exclusive by construction.
export type ParsedAssignee = { assignedCompanyId: number | null; assignedInterimId: number | null };

export function parseAssignee(value: string | null | undefined): ParsedAssignee {
    const empty: ParsedAssignee = { assignedCompanyId: null, assignedInterimId: null };
    const [kind, idStr] = (value ?? "").split(":");
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) return empty;
    if (kind === "company") return { assignedCompanyId: id, assignedInterimId: null };
    if (kind === "interim") return { assignedCompanyId: null, assignedInterimId: id };
    return empty;
}

export const ASSIGNEE_TARGET_KINDS = ["task", "group", "category"] as const;
export type AssigneeTargetKind = (typeof ASSIGNEE_TARGET_KINDS)[number];
