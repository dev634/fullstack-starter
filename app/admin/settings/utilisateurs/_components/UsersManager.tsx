'use client'
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, PencilIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import Modal from "@/components/Modal";
import ModalShell from "@/components/ModalShell";
import { addUser, updateUser, deleteUser } from "@/actions/users/users";
import { ROLE_RANK } from "@/lib/capabilities";
import type { UserActionState } from "@/types/user";
import type { Role } from "@/app/generated/prisma/client";

type JobFunctionOption = { id: number; name: string };
type ManagedUser = {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  createdAt: Date;
  jobFunctionId: number | null;
  jobFunction: { name: string } | null;
};
type Editing = { mode: "add" } | { mode: "edit"; user: ManagedUser };

const RANK = ROLE_RANK;
// CLIENT logins are created/managed from a contact, never assigned here.
const ALL_ROLES: Role[] = ["SUPERADMIN", "ADMIN", "EDITOR", "VIEWER"];
const initialState: UserActionState = { type: null, message: "" };

const roleBadge: Record<Role, string> = {
  SUPERADMIN: "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300",
  ADMIN: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  EDITOR: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300",
  VIEWER: "bg-gray-200 text-gray-700 dark:bg-gray-600/40 dark:text-gray-300",
  CLIENT: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
};
const inputClass =
  "w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500";

export default function UsersManager({
  users,
  actorRole,
  actorEmail,
  functions,
}: {
  users: ManagedUser[];
  actorRole: Role;
  actorEmail: string;
  functions: JobFunctionOption[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("VIEWER");
  const [jobFunctionId, setJobFunctionId] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>();

  const [toDelete, setToDelete] = useState<ManagedUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Roles the actor may assign / manage: only at or below their own rank.
  const assignableRoles = ALL_ROLES.filter((r) => RANK[actorRole] >= RANK[r]);
  const canManage = (target: ManagedUser) => RANK[actorRole] >= RANK[target.role];

  function openAdd() {
    setEmail("");
    setName("");
    setRole(assignableRoles[assignableRoles.length - 1] ?? "VIEWER");
    setJobFunctionId(null);
    setPassword("");
    setError(null);
    setFieldErrors(undefined);
    setEditing({ mode: "add" });
  }

  function openEdit(user: ManagedUser) {
    setEmail(user.email);
    setName(user.name ?? "");
    setRole(user.role);
    setJobFunctionId(user.jobFunctionId);
    setPassword("");
    setError(null);
    setFieldErrors(undefined);
    setEditing({ mode: "edit", user });
  }

  function submit() {
    if (!editing) return;
    setError(null);
    setFieldErrors(undefined);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("name", name.trim());
      fd.set("role", role);
      fd.set("jobFunctionId", jobFunctionId ? String(jobFunctionId) : "");
      if (password) fd.set("password", password);
      let res: UserActionState;
      if (editing.mode === "add") {
        fd.set("email", email.trim());
        res = await addUser(initialState, fd);
      } else {
        fd.set("id", String(editing.user.id));
        res = await updateUser(initialState, fd);
      }
      if (res.type !== "success") {
        setError(res.message);
        if (res.type === "zodError") setFieldErrors(res.fieldsForm);
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    startTransition(async () => {
      const res = await deleteUser(toDelete.id);
      setDeleting(false);
      if (res.type === "error") {
        setDeleteError(res.message);
        return;
      }
      setToDelete(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-2 text-sm font-bold text-white hover:bg-primary/90 cursor-pointer"
        >
          <PlusIcon className="h-4 w-4" />
          {t.users.addToggle}
        </button>
      </div>

      {users.length ? (
        <ul className="divide-y divide-gray-300 dark:divide-gray-700 overflow-hidden rounded-lg border border-gray-300 dark:border-gray-700">
          {users.map((u) => {
            const isSelf = u.email === actorEmail;
            const manageable = canManage(u);
            return (
              <li key={u.id} className="flex items-center gap-3 bg-[#f3f4f6] px-4 py-3 dark:bg-[#1f2937]">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {u.name || u.email}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${roleBadge[u.role]}`}>
                      {t.users.roles[u.role]}
                    </span>
                    {isSelf && <span className="shrink-0 text-xs text-gray-400">({t.users.you})</span>}
                  </span>
                  {(() => {
                    const secondary = [u.name ? u.email : null, u.jobFunction?.name].filter(Boolean).join(" · ");
                    return secondary ? (
                      <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{secondary}</span>
                    ) : null;
                  })()}
                </span>
                {manageable && (
                  <button
                    type="button"
                    onClick={() => openEdit(u)}
                    aria-label={t.users.editTitle}
                    className="shrink-0 cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-500/10 dark:text-gray-400"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                )}
                {manageable && !isSelf && (
                  <button
                    type="button"
                    onClick={() => setToDelete(u)}
                    aria-label={format(t.users.deleteLabel, { name: u.name || u.email })}
                    className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 dark:text-red-400"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t.users.empty}</p>
      )}

      <ModalShell
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.mode === "edit" ? t.users.editTitle : t.users.addTitle}
      >
        <div className="flex flex-col gap-3">
          {editing?.mode === "add" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t.users.emailLabel}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
              {fieldErrors?.email && <p className="mt-1 text-xs text-red-500">{fieldErrors.email}</p>}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t.users.nameLabel}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t.users.roleLabel}</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>
              {assignableRoles.map((r) => (
                <option key={r} value={r}>{t.users.roles[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t.users.functionLabel}</label>
            <select
              value={jobFunctionId ?? ""}
              onChange={(e) => setJobFunctionId(e.target.value ? Number(e.target.value) : null)}
              className={inputClass}
            >
              <option value="">{t.users.functionNone}</option>
              {functions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t.users.passwordLabel}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
            <p className="mt-1 text-xs text-gray-400">
              {editing?.mode === "edit" ? t.users.passwordEditHint : t.users.passwordCreateHint}
            </p>
            {fieldErrors?.password && <p className="mt-1 text-xs text-red-500">{fieldErrors.password}</p>}
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded bg-gray-100 px-4 py-2 font-bold text-gray-900 hover:bg-[#d1d5dc] dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 cursor-pointer"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${pending ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {editing?.mode === "edit" ? t.users.save : t.users.add}
            </button>
          </div>
        </div>
      </ModalShell>

      {toDelete && (
        <Modal
          title={t.users.deleteTitle}
          text={format(t.users.deleteText, { name: toDelete.name || toDelete.email })}
          error={deleteError ?? undefined}
          textForCancel={t.common.cancel}
          textForConfirm={t.common.delete}
          onClose={() => !deleting && setToDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
