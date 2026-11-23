import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { normalizeHiddenAreas, type AppAreaKey } from "@/lib/appAreas";
import { PRIVILEGED_ROLES } from "@/lib/accountPolicy";

/**
 * A refusal decided INSIDE a transaction, by a guard the action hands the
 * repository: thrown so the transaction rolls back, and recognised by the
 * action to answer with its own message. `reason` is the guard's own code.
 */
export type GuardRefusal = { type: "guardRefused"; reason: string };

export function guardRefusal(reason: string): GuardRefusal {
    return { type: "guardRefused", reason };
}

export function isGuardRefusal(error: unknown): error is GuardRefusal {
    return !!error && typeof error === "object" && "type" in error && error.type === "guardRefused" && "reason" in error && typeof error.reason === "string";
}

/**
 * Lock the given JobFunction rows (SELECT ... FOR UPDATE) for the rest of the
 * transaction and return what each hides — read AFTER the lock is held, so the
 * caller decides on the state it is about to write over. Whoever checks the
 * relay rule on a function and then writes (an account taking it, the function
 * being reconfigured or deleted) does both under this lock: without it, the
 * check and the write are two round trips and a parallel request slips between
 * them. A creation of a User pointing at the row also queues behind it (the FK
 * check takes a conflicting share lock). Rows are locked in ascending id order,
 * so two transactions locking several never wait on each other crosswise. An id
 * with no row is simply absent from the map.
 */
export async function lockFunctionsForUpdate(
    tx: Prisma.TransactionClient,
    ids: readonly number[]
): Promise<Map<number, AppAreaKey[]>> {
    const unique = [...new Set(ids)].sort((a, b) => a - b);
    if (unique.length === 0) return new Map();
    const rows = await tx.$queryRaw<{ id: number; hiddenAreas: string[] }[]>(
        Prisma.sql`SELECT "id", "hiddenAreas" FROM "JobFunction" WHERE "id" IN (${Prisma.join(unique)}) ORDER BY "id" FOR UPDATE`
    );
    return new Map(rows.map((r) => [r.id, normalizeHiddenAreas(r.hiddenAreas)]));
}

/** What a guard sees of a function, read under its lock. */
export type HeldFunctionState = { hiddenAreas: AppAreaKey[]; holders: number; privilegedHolders: number };

/** Decides, from the locked state, whether the change may go on: a refusal code, or null. */
export type FunctionGuard = (state: HeldFunctionState) => string | null;

/** Lock the function, read its state, and throw the guard's refusal — all inside `tx`. */
async function enforceGuard(tx: Prisma.TransactionClient, id: number, guard: FunctionGuard | null): Promise<void> {
    if (!guard) return;
    const locked = await lockFunctionsForUpdate(tx, [id]);
    const [holders, privilegedHolders] = await Promise.all([
        tx.user.count({ where: { jobFunctionId: id } }),
        tx.user.count({ where: { jobFunctionId: id, role: { in: PRIVILEGED_ROLES } } }),
    ]);
    const reason = guard({ hiddenAreas: locked.get(id) ?? [], holders, privilegedHolders });
    if (reason !== null) throw guardRefusal(reason);
}

/** All job functions, in their manual (drag-and-drop) display order. */
export async function findAll() {
    try {
        return await prisma.jobFunction.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }] });
    } catch (error) {
        console.log("Repository findAll (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching functions." };
    }
}

/**
 * Just id + name, in display order — for populating dropdowns. Avoids
 * serializing the whole JobFunction row (hiddenSections / hiddenAreas /
 * projectScope — the access posture) to the client, unlike findAll().
 */
export async function findAllOptions() {
    try {
        return await prisma.jobFunction.findMany({
            select: { id: true, name: true },
            orderBy: [{ position: "asc" }, { name: "asc" }],
        });
    } catch (error) {
        console.log("Repository findAllOptions (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching functions." };
    }
}

export async function create(name: string) {
    try {
        // New functions go to the end of the list.
        const last = await prisma.jobFunction.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
        const position = (last?.position ?? -1) + 1;
        return await prisma.jobFunction.create({ data: { name, position } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw { type: "duplicate", message: "This function already exists." };
        }
        console.log("Repository create (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error creating function." };
    }
}

/**
 * Delete a function. `guard` (null for a caller nobody guards: a SUPERADMIN)
 * runs under the row lock, in the same transaction as the delete — see
 * lockFunctionsForUpdate. Required, not optional: omitting it must be written.
 */
export async function remove(id: number, guard: FunctionGuard | null) {
    try {
        return await prisma.$transaction(async (tx) => {
            await enforceGuard(tx, id, guard);
            return tx.jobFunction.delete({ where: { id } });
        });
    } catch (error) {
        if (isGuardRefusal(error)) throw error;
        console.log("Repository remove (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error deleting function." };
    }
}

/**
 * Write a function's whole access configuration — hidden project sections,
 * hidden app areas, project scope — in ONE statement. A single `update` on one
 * row is atomic by itself (all three columns land, or none does), which is
 * the point: the three former setters ran in parallel and a failure in one
 * left the other two written. `guard` (null for a caller nobody guards) runs
 * under the row lock in the same transaction — see lockFunctionsForUpdate.
 */
export async function updateConfig(
    id: number,
    config: { hiddenSections: string[]; hiddenAreas: string[]; projectScope: "ALL" | "ASSIGNED" },
    guard: FunctionGuard | null
) {
    try {
        return await prisma.$transaction(async (tx) => {
            await enforceGuard(tx, id, guard);
            return tx.jobFunction.update({
                where: { id },
                data: {
                    hiddenSections: config.hiddenSections,
                    hiddenAreas: config.hiddenAreas,
                    projectScope: config.projectScope,
                },
            });
        });
    } catch (error) {
        if (isGuardRefusal(error)) throw error;
        console.log("Repository updateConfig (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error updating function configuration." };
    }
}

/** Persist a new order: each id's position becomes its index in the array. */
export async function reorder(orderedIds: number[]) {
    try {
        return await prisma.$transaction(
            orderedIds.map((id, index) => prisma.jobFunction.update({ where: { id }, data: { position: index } }))
        );
    } catch (error) {
        console.log("Repository reorder (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error reordering functions." };
    }
}

/** What a function hides, for the account policy (lib/accountPolicy.ts): normalized keys only. */
export async function findHiddenAreasById(id: number): Promise<AppAreaKey[]> {
    try {
        const row = await prisma.jobFunction.findUnique({ where: { id }, select: { hiddenAreas: true } });
        return normalizeHiddenAreas(row?.hiddenAreas);
    } catch (error) {
        console.log("Repository findHiddenAreasById (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching function." };
    }
}

/** id + hiddenAreas of every function, in one query — server-side input of the screen's policy computations, never sent as is. */
export async function findAllHiddenAreas(): Promise<{ id: number; hiddenAreas: AppAreaKey[] }[]> {
    try {
        const rows = await prisma.jobFunction.findMany({ select: { id: true, hiddenAreas: true } });
        return rows.map((r) => ({ id: r.id, hiddenAreas: normalizeHiddenAreas(r.hiddenAreas) }));
    } catch (error) {
        console.log("Repository findAllHiddenAreas (jobFunction) error:", error);
        throw { type: "repositoryError", message: "Database Error fetching functions." };
    }
}
