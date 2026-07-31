'use client'
import { useRef, useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { MapPinIcon, TrashIcon, XMarkIcon, PhotoIcon, FolderIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { planPageImageUrl } from "@/lib/cloudinary-url";
import Modal from "@/components/Modal";
import ModalShell from "@/components/ModalShell";
import {
  deleteReservePlan,
  addReserve,
  updateReserve,
  deleteReserve,
  addReservePhoto,
  deleteReservePhoto,
  addReserveFolder,
  deleteReserveFolder,
  moveReservePlan,
} from "@/actions/reserves/reserves";
import type { Reserve, ReservePlan, ReservePhoto, ReserveStatus } from "@/app/generated/prisma/client";

type ReserveWithPhotos = Reserve & { photos: ReservePhoto[] };
type PlanWithReserves = ReservePlan & { reserves: ReserveWithPhotos[] };
type Editor =
  | { mode: "new"; x: number; y: number }
  | { mode: "edit"; reserveId: number; index: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const inputClass =
  "w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500";

export default function ReservesSection({
  clientId,
  projectId,
  plans,
  folders,
  canEdit,
}: {
  clientId: number;
  projectId: number;
  plans: PlanWithReserves[];
  folders: { id: number; name: string }[];
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(plans[0]?.id ?? null);
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null;

  // Plan add lives in the section header (AddReservePlanForm); here we only
  // choose/delete a plan and pin réserves on it.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [planToDelete, setPlanToDelete] = useState<PlanWithReserves | null>(null);

  // Folder organisation of plans.
  const rootPlans = plans.filter((p) => p.folderId == null);
  const plansInFolder = (folderId: number) => plans.filter((p) => p.folderId === folderId);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);

  function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setFolderError(null);
    startTransition(async () => {
      const res = await addReserveFolder(name, clientId, projectId);
      if (res.type !== "success") {
        setFolderError(res.message);
        return;
      }
      setNewFolderName("");
      router.refresh();
    });
  }

  function removeFolder(id: number) {
    setFolderError(null);
    startTransition(async () => {
      const res = await deleteReserveFolder(id, clientId, projectId);
      if (res.type !== "success") {
        setFolderError(res.message);
        return;
      }
      router.refresh();
    });
  }

  function movePlanToFolder(folderId: number | null) {
    if (!selectedPlan) return;
    startTransition(async () => {
      await moveReservePlan(selectedPlan.id, folderId, clientId, projectId);
      router.refresh();
    });
  }

  // Réserve editor
  const [editor, setEditor] = useState<Editor | null>(null);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ReserveStatus>("OPEN");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locating, setLocating] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [confirmDeleteReserve, setConfirmDeleteReserve] = useState(false);

  function resetEditorFields(r?: Reserve) {
    setDescription(r?.description ?? "");
    setStatus(r?.status ?? "OPEN");
    setLat(r?.latitude != null ? String(r.latitude) : "");
    setLng(r?.longitude != null ? String(r.longitude) : "");
    setEditorError(null);
    setLocating(false);
    setConfirmDeleteReserve(false);
  }

  function closeEditor() {
    setEditor(null);
  }

  function handlePlanClick(e: MouseEvent<HTMLImageElement>) {
    if (!canEdit || !selectedPlan) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);
    resetEditorFields();
    setEditor({ mode: "new", x, y });
  }

  function openReserve(reserve: ReserveWithPhotos, index: number) {
    resetEditorFields(reserve);
    setEditor({ mode: "edit", reserveId: reserve.id, index });
  }

  function captureLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setEditorError(t.reserves.geolocationUnavailable);
      return;
    }
    setLocating(true);
    setEditorError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setEditorError(t.reserves.geolocationError);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function submitReserve() {
    if (!editor || !selectedPlan || !description.trim()) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("clientId", String(clientId));
      fd.set("projectId", String(projectId));
      fd.set("description", description.trim());
      fd.set("status", status);
      fd.set("latitude", lat);
      fd.set("longitude", lng);
      let res;
      if (editor.mode === "new") {
        fd.set("planId", String(selectedPlan.id));
        fd.set("x", String(editor.x));
        fd.set("y", String(editor.y));
        res = await addReserve({ type: null, message: "" }, fd);
      } else {
        fd.set("id", String(editor.reserveId));
        res = await updateReserve({ type: null, message: "" }, fd);
      }
      if (res.type !== "success") {
        setEditorError(res.message);
        return;
      }
      closeEditor();
      router.refresh();
    });
  }

  function removeCurrentReserve() {
    if (!editor || editor.mode !== "edit") return;
    const reserveId = editor.reserveId;
    startTransition(async () => {
      const res = await deleteReserve(reserveId, clientId, projectId);
      if (res.type !== "success") {
        setEditorError(res.message);
        return;
      }
      closeEditor();
      router.refresh();
    });
  }

  function uploadPhoto(file: File) {
    if (!editor || editor.mode !== "edit") return;
    const reserveId = editor.reserveId;
    setEditorError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("clientId", String(clientId));
      fd.set("projectId", String(projectId));
      fd.set("reserveId", String(reserveId));
      fd.set("file", file);
      const res = await addReservePhoto({ type: null, message: "" }, fd);
      if (photoInputRef.current) photoInputRef.current.value = "";
      if (res.type !== "success") {
        setEditorError(res.message);
        return;
      }
      router.refresh();
    });
  }

  function removePhoto(id: number) {
    setEditorError(null);
    startTransition(async () => {
      const res = await deleteReservePhoto(id, clientId, projectId);
      if (res.type !== "success") {
        setEditorError(res.message);
        return;
      }
      router.refresh();
    });
  }

  function confirmRemovePlan() {
    if (!planToDelete) return;
    const plan = planToDelete;
    startTransition(async () => {
      const res = await deleteReservePlan(plan.id, clientId, projectId);
      if (res.type === "success") {
        setPlanToDelete(null);
        if (selectedPlanId === plan.id) setSelectedPlanId(null);
        router.refresh();
      }
    });
  }

  // Live editing réserve derived from props so its photos refresh after an
  // upload/delete (the `editor` only holds its id + index, never a stale copy).
  const editingReserve =
    editor?.mode === "edit" ? selectedPlan?.reserves.find((r) => r.id === editor.reserveId) : undefined;
  const photos = editingReserve?.photos ?? [];

  const pinColor = (s: ReserveStatus) =>
    s === "RESOLVED"
      ? "bg-green-600 border-white dark:border-gray-900"
      : "bg-rose-600 border-white dark:border-gray-900";

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
      {/* Plan chooser + actions */}
      <div className="flex flex-wrap items-center gap-2">
        {plans.length > 0 && (
          <select
            value={selectedPlan?.id ?? ""}
            onChange={(e) => setSelectedPlanId(Number(e.target.value))}
            aria-label={t.reserves.planSelectLabel}
            className="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
          >
            {folders.length === 0 ? (
              plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {format(t.reserves.reserveCount, { count: p.reserves.length })}
                </option>
              ))
            ) : (
              <>
                {rootPlans.length > 0 && (
                  <optgroup label={t.reserves.noFolder}>
                    {rootPlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {format(t.reserves.reserveCount, { count: p.reserves.length })}
                      </option>
                    ))}
                  </optgroup>
                )}
                {folders.map((f) => {
                  const fp = plansInFolder(f.id);
                  return fp.length > 0 ? (
                    <optgroup key={f.id} label={f.name}>
                      {fp.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {format(t.reserves.reserveCount, { count: p.reserves.length })}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </>
            )}
          </select>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setFoldersOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 px-2.5 py-2 text-sm hover:bg-[#d1d5dc] dark:hover:bg-gray-700 cursor-pointer"
          >
            <FolderIcon className="h-4 w-4" />
            {t.reserves.folders}
          </button>
        )}
        {canEdit && selectedPlan && (
          <button
            type="button"
            onClick={() => setPlanToDelete(selectedPlan)}
            aria-label={format(t.reserves.deletePlan, { name: selectedPlan.name })}
            className="shrink-0 cursor-pointer rounded border border-gray-300 p-2 text-red-500 hover:bg-red-500/10 dark:border-gray-600 dark:text-red-400"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Move the selected plan to a folder */}
      {canEdit && selectedPlan && folders.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="shrink-0">{t.reserves.moveToFolderLabel}</span>
          <select
            value={selectedPlan.folderId ?? ""}
            onChange={(e) => movePlanToFolder(e.target.value ? Number(e.target.value) : null)}
            disabled={pending}
            className="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-1.5 text-sm text-gray-900 dark:text-gray-100"
          >
            <option value="">{t.reserves.noFolder}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
      )}

      {/* Plan viewer */}
      {!selectedPlan ? (
        <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{t.reserves.noPlans}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {canEdit && <p className="text-xs text-gray-500 dark:text-gray-400">{t.reserves.addHint}</p>}
          <div className="relative select-none overflow-hidden rounded border border-gray-300 dark:border-gray-700">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={planPageImageUrl(selectedPlan.url)}
              alt={selectedPlan.name}
              onClick={handlePlanClick}
              className={`block w-full ${canEdit ? "cursor-crosshair" : ""}`}
            />
            {selectedPlan.reserves.map((reserve, index) => (
              <button
                key={reserve.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openReserve(reserve, index);
                }}
                style={{ left: `${reserve.x * 100}%`, top: `${reserve.y * 100}%` }}
                aria-label={`${index + 1} — ${reserve.description}`}
                title={reserve.description}
                className="absolute -translate-x-1/2 -translate-y-full cursor-pointer"
              >
                {/* Teardrop map marker: round head, sharp corner rotated to a
                    downward tip that sits on the exact spot. */}
                <span
                  className={`flex h-6 w-6 rotate-45 items-center justify-center rounded-full rounded-bl-none border-2 text-xs font-bold text-white shadow ${pinColor(reserve.status)}`}
                >
                  <span className="-rotate-45">{index + 1}</span>
                </span>
              </button>
            ))}
            {editor?.mode === "new" && (
              <span
                style={{ left: `${editor.x * 100}%`, top: `${editor.y * 100}%` }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-full"
              >
                <span className="block h-6 w-6 rotate-45 animate-pulse rounded-full rounded-bl-none border-2 border-white bg-rose-600/70 dark:border-gray-900" />
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">{t.reserves.planUnavailableHint}</p>
        </div>
      )}

      {/* Réserve editor modal */}
      <ModalShell
        open={editor !== null}
        onClose={closeEditor}
        title={
          editor?.mode === "edit"
            ? `${t.reserves.editReserveTitle} n°${editor.index + 1}`
            : t.reserves.newReserveTitle
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.reserves.descriptionLabel}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit || pending}
              rows={3}
              placeholder={t.reserves.descriptionPlaceholder}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.reserves.statusLabel}
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ReserveStatus)}
              disabled={!canEdit || pending}
              className={inputClass}
            >
              <option value="OPEN">{t.reserves.status.OPEN}</option>
              <option value="RESOLVED">{t.reserves.status.RESOLVED}</option>
            </select>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{t.reserves.gpsHeading}</label>
              {canEdit && (
                <button
                  type="button"
                  onClick={captureLocation}
                  disabled={locating || pending}
                  className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs hover:bg-[#d1d5dc] dark:hover:bg-gray-700 cursor-pointer disabled:opacity-50"
                >
                  <MapPinIcon className="h-3.5 w-3.5" />
                  {locating ? t.reserves.locating : t.reserves.useMyLocation}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                disabled={!canEdit || pending}
                placeholder={t.reserves.latitudeLabel}
                aria-label={t.reserves.latitudeLabel}
                className={inputClass}
              />
              <input
                type="text"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                disabled={!canEdit || pending}
                placeholder={t.reserves.longitudeLabel}
                aria-label={t.reserves.longitudeLabel}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.reserves.photosHeading}
            </label>
            {editor?.mode === "edit" ? (
              <div className="flex flex-wrap gap-2">
                {photos.map((p) => (
                  <div key={p.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt=""
                      className="h-16 w-16 rounded border border-gray-300 object-cover dark:border-gray-700"
                    />
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removePhoto(p.id)}
                        disabled={pending}
                        aria-label={t.reserves.deletePhoto}
                        className="absolute -right-1.5 -top-1.5 cursor-pointer rounded-full bg-red-600 p-0.5 text-white shadow hover:bg-red-700 disabled:opacity-50"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-gray-300 text-gray-400 hover:bg-gray-500/10 dark:border-gray-600">
                    {pending ? (
                      <span className="px-1 text-center text-[10px]">{t.reserves.uploadingPhoto}</span>
                    ) : (
                      <>
                        <PhotoIcon className="h-5 w-5" />
                        <span className="px-1 text-center text-[10px] leading-tight">{t.reserves.addPhoto}</span>
                      </>
                    )}
                    {/* No `capture` attribute: on mobile this lets the user pick the
                        camera OR an existing photo from the gallery. */}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      disabled={pending}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadPhoto(f);
                      }}
                      className="hidden"
                    />
                  </label>
                )}
                {photos.length === 0 && !canEdit && <p className="text-xs text-gray-400">—</p>}
              </div>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500">{t.reserves.photosAfterSave}</p>
            )}
          </div>

          {editorError && <p className="text-xs text-red-500">{editorError}</p>}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {canEdit && editor?.mode === "edit" && (
              <button
                type="button"
                onClick={() => (confirmDeleteReserve ? removeCurrentReserve() : setConfirmDeleteReserve(true))}
                disabled={pending}
                className="mr-auto rounded border border-red-500/40 px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10 cursor-pointer dark:text-red-400"
              >
                {confirmDeleteReserve ? t.reserves.deleteReserveText : t.reserves.deleteReserve}
              </button>
            )}
            <button
              type="button"
              onClick={closeEditor}
              className="rounded bg-gray-100 px-4 py-2 font-bold text-gray-900 hover:bg-[#d1d5dc] dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 cursor-pointer"
            >
              {t.common.cancel}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={submitReserve}
                disabled={!description.trim() || pending}
                className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${
                  !description.trim() || pending ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {editor?.mode === "edit" ? t.reserves.save : t.reserves.add}
              </button>
            )}
          </div>
        </div>
      </ModalShell>

      {planToDelete && (
        <Modal
          title={format(t.reserves.deletePlan, { name: planToDelete.name })}
          text={format(t.reserves.deletePlanText, { name: planToDelete.name })}
          textForCancel={t.common.cancel}
          textForConfirm={t.common.delete}
          onClose={() => !pending && setPlanToDelete(null)}
          onConfirm={confirmRemovePlan}
        />
      )}

      {/* Folder management */}
      <ModalShell open={foldersOpen} onClose={() => setFoldersOpen(false)} title={t.reserves.folders}>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createFolder(); } }}
              placeholder={t.reserves.newFolderPlaceholder}
              className={inputClass}
            />
            <button
              type="button"
              onClick={createFolder}
              disabled={pending || !newFolderName.trim()}
              className={`shrink-0 rounded bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 cursor-pointer ${
                pending || !newFolderName.trim() ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {t.reserves.addFolderSubmit}
            </button>
          </div>
          {folderError && <p className="text-xs text-red-500">{folderError}</p>}
          {folders.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t.reserves.noFoldersYet}</p>
          ) : (
            <ul className="divide-y divide-gray-300 dark:divide-gray-700 overflow-hidden rounded border border-gray-300 dark:border-gray-700">
              {folders.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 px-3 py-2">
                  <span className="min-w-0 truncate text-sm">
                    {f.name}
                    <span className="ml-1.5 text-xs text-gray-400">({plansInFolder(f.id).length})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFolder(f.id)}
                    disabled={pending}
                    aria-label={format(t.reserves.deleteFolder, { name: f.name })}
                    title={format(t.reserves.deleteFolderText, { name: f.name })}
                    className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ModalShell>
    </div>
  );
}
