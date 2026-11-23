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

const ASSIGNEE_VALUE = /^(company|interim|worker):([1-9]\d*)$/;

/**
 * Reads the picker's one-field encoding. Only the EXPLICIT "no assignee" — the
 * empty string, the picker's "Non assigné" option — means "clear". A value
 * that is not understood (unknown kind, an id that is not a positive integer,
 * a stray separator) is REFUSED with `null`: it used to be normalised to "no
 * assignee", so a typo erased an existing assignment instead of failing.
 */
export function parseAssignee(value: string): ParsedAssignee | null {
    if (value === "") return { assignedCompanyId: null, assignedInterimId: null, assignedWorkerId: null };
    const m = ASSIGNEE_VALUE.exec(value);
    if (m === null) return null;
    const id = Number(m[2]);
    if (!Number.isSafeInteger(id)) return null;
    if (m[1] === "company") return { assignedCompanyId: id, assignedInterimId: null, assignedWorkerId: null };
    if (m[1] === "interim") return { assignedCompanyId: null, assignedInterimId: id, assignedWorkerId: null };
    return { assignedCompanyId: null, assignedInterimId: null, assignedWorkerId: id };
}

export const ASSIGNEE_TARGET_KINDS = ["task", "group", "category"] as const;
export type AssigneeTargetKind = (typeof ASSIGNEE_TARGET_KINDS)[number];
