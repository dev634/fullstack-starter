'use client'
import { useRef, useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { MapPinIcon, TrashIcon, PlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { planPageImageUrl } from "@/lib/cloudinary-url";
import Modal from "@/components/Modal";
import ModalShell from "@/components/ModalShell";
import {
  addReservePlan,
  deleteReservePlan,
  addReserve,
  updateReserve,
  deleteReserve,
} from "@/actions/reserves/reserves";
import type { Reserve, ReservePlan, ReserveStatus } from "@/app/generated/prisma/client";

type PlanWithReserves = ReservePlan & { reserves: Reserve[] };
type Editor =
  | { mode: "new"; x: number; y: number }
  | { mode: "edit"; reserve: Reserve; index: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const inputClass =
  "w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500";

export default function ReservesSection({
  clientId,
  projectId,
  plans,
  canEdit,
}: {
  clientId: number;
  projectId: number;
  plans: PlanWithReserves[];
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(plans[0]?.id ?? null);
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null;

  // Plan upload
  const [showUpload, setShowUpload] = useState(false);
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [planName, setPlanName] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const planFileRef = useRef<HTMLInputElement>(null);
  const [planToDelete, setPlanToDelete] = useState<PlanWithReserves | null>(null);

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

  function openReserve(reserve: Reserve, index: number) {
    resetEditorFields(reserve);
    setEditor({ mode: "edit", reserve, index });
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

  function submitPlan() {
    if (!planFile) return;
    setUploadError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("clientId", String(clientId));
      fd.set("projectId", String(projectId));
      fd.set("file", planFile);
      if (planName.trim()) fd.set("name", planName.trim());
      const res = await addReservePlan({ type: null, message: "" }, fd);
      if (res.type !== "success") {
        setUploadError(res.message);
        return;
      }
      setPlanFile(null);
      setPlanName("");
      setShowUpload(false);
      if (planFileRef.current) planFileRef.current.value = "";
      if (res.data && typeof res.data === "object" && "id" in res.data) {
        setSelectedPlanId((res.data as { id: number }).id);
      }
      router.refresh();
    });
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
        fd.set("id", String(editor.reserve.id));
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
    startTransition(async () => {
      const res = await deleteReserve(editor.reserve.id, clientId, projectId);
      if (res.type !== "success") {
        setEditorError(res.message);
        return;
      }
      closeEditor();
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
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {format(t.reserves.reserveCount, { count: p.reserves.length })}
              </option>
            ))}
          </select>
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
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowUpload((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-2 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {t.reserves.addPlanToggle}
          </button>
        )}
      </div>

      {/* Upload form */}
      {canEdit && showUpload && (
        <div className="flex flex-col gap-2 rounded border border-gray-300 p-3 dark:border-gray-700">
          <input
            ref={planFileRef}
            type="file"
            accept="application/pdf,.pdf"
            aria-label={t.reserves.choosePlanFile}
            onChange={(e) => setPlanFile(e.target.files?.[0] ?? null)}
            className="text-sm text-gray-500 dark:text-gray-400 file:mr-3 file:rounded file:border-0 file:bg-gray-100 dark:file:bg-gray-700 file:px-3 file:py-1.5 file:text-sm file:text-gray-900 dark:file:text-gray-100 file:cursor-pointer"
          />
          <input
            type="text"
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
            placeholder={t.reserves.planNamePlaceholder}
            aria-label={t.reserves.planNamePlaceholder}
            className={inputClass}
          />
          {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
          <button
            type="button"
            onClick={submitPlan}
            disabled={!planFile || pending}
            className={`self-start rounded bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary/90 cursor-pointer ${
              !planFile || pending ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            {pending ? t.reserves.uploadingPlan : t.reserves.addPlanSubmit}
          </button>
        </div>
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
                className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-2 text-xs font-bold text-white shadow ${pinColor(reserve.status)}`}
              >
                {index + 1}
              </button>
            ))}
            {editor?.mode === "new" && (
              <span
                style={{ left: `${editor.x * 100}%`, top: `${editor.y * 100}%` }}
                className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-white bg-rose-600/70 dark:border-gray-900"
              />
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
    </div>
  );
}
