'use client'
import { useRef, useState, useTransition, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MapPinIcon,
  TrashIcon,
  XMarkIcon,
  PhotoIcon,
  HomeIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import ReserveFolderRow from "@/components/ReserveFolderRow";
import ReserveStatusBadge from "@/components/ReserveStatusBadge";
import { RESERVE_FOLDER_PARAM } from "@/lib/reserveFolderParam";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { assetPath } from "@/lib/assetPath";
import { summarizeReserves } from "@/lib/reservesReportData";
import Modal from "@/components/Modal";
import ModalShell from "@/components/ModalShell";
import {
  deleteReservePlan,
  addReserve,
  updateReserve,
  deleteReserve,
  addReservePhoto,
  deleteReservePhoto,
  moveReservePlan,
} from "@/actions/reserves/reserves";
import type { Reserve, ReservePlan, ReservePhoto, ReserveStatus } from "@/app/generated/prisma/client";

// `url` never travels past the repository here: findByProject
// (repository/reservePlans.ts) omits it at both the plan and the photo
// level, because this whole tree is passed straight into this Client
// Component's props — which get serialized into the page's HTML — and the
// deprecated column must not reach the browser (see ProjectFile.url's doc in
// prisma/schema.prisma). Every plan/photo image is built from its id alone
// (lib/assetPath.ts), never from a stored URL.
type ReserveWithPhotos = Reserve & { photos: Omit<ReservePhoto, "url">[] };
type PlanWithReserves = Omit<ReservePlan, "url"> & { reserves: ReserveWithPhotos[] };
type Editor =
  | { mode: "new"; x: number; y: number }
  | { mode: "edit"; reserveId: number; number: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const inputClass =
  "w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500";

export default function ReservesSection({
  clientId,
  projectId,
  plans,
  subfolders,
  breadcrumb,
  allFolders,
  currentFolderId,
  canEdit,
}: {
  clientId: number;
  projectId: number;
  plans: PlanWithReserves[];
  /** Direct child folders of the current level. */
  subfolders: { id: number; name: string }[];
  /** Root→current chain, for the breadcrumb (empty at the root). */
  breadcrumb: { id: number; name: string }[];
  /** Every folder in the project — the "move to folder" target list. */
  allFolders: { id: number; name: string }[];
  /** Folder being browsed, or null for the project root (from ?rfolder=). */
  currentFolderId: number | null;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Plans shown at this level are those filed directly in the current folder
  // (or unfiled, at the root). Subfolders are navigated into, not expanded.
  const visiblePlans = plans.filter((p) => (p.folderId ?? null) === currentFolderId);

  // Selection is derived, not stored: navigating into a folder whose plans
  // don't include the previous pick falls back to the first one here, so no
  // effect is needed and the viewer can never show a plan from another folder.
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const selectedPlan =
    visiblePlans.find((p) => p.id === selectedPlanId) ?? visiblePlans[0] ?? null;

  // Whether the CURRENT plan's viewer image failed to load (a guarded asset
  // can fail: 502 if Cloudinary is down, 404 if access was revoked between
  // render and request — see ClientAvatar's `failed` state for the same
  // pattern). Tracked against the plan id it failed for, and cleared as soon
  // as `selectedPlan` moves to a different plan — adjusting this component's
  // OWN state during render (not a prop callback) is legal, and is how a
  // derived value gets reset the moment the signal it depends on changes.
  const [planImgFailed, setPlanImgFailed] = useState(false);
  const [planImgFailedFor, setPlanImgFailedFor] = useState<number | null>(null);
  if (selectedPlan && selectedPlan.id !== planImgFailedFor && planImgFailed) {
    setPlanImgFailed(false);
    setPlanImgFailedFor(selectedPlan.id);
  }

  // Plan add lives in the section header (AddReservePlanForm); here we only
  // browse/choose/delete a plan and pin réserves on it.
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [planToDelete, setPlanToDelete] = useState<PlanWithReserves | null>(null);

  // "Open only" filter for the textual list below the viewer — local UI
  // state on purpose, not the URL: the selected plan is itself local state,
  // so a shared link wouldn't open any plan and the filter would have
  // nothing to apply to.
  const [openOnly, setOpenOnly] = useState(false);
  const selectedPlanReserves = selectedPlan?.reserves ?? [];
  const filteredReserves = openOnly
    ? selectedPlanReserves.filter((r) => r.status === "OPEN")
    : selectedPlanReserves;

  const plansInFolder = (folderId: number) => plans.filter((p) => p.folderId === folderId);

  // Build a browse href for a given réserve folder (null = root), keeping any
  // other section's query state — the Files module browses through ?folder= on
  // this same page and must not be reset.
  const searchParams = useSearchParams();
  const folderHref = (folderId: number | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (folderId == null) params.delete(RESERVE_FOLDER_PARAM);
    else params.set(RESERVE_FOLDER_PARAM, String(folderId));
    const q = params.toString();
    return `/clients/${clientId}/projects/${projectId}${q ? `?${q}` : ""}`;
  };

  function movePlanToFolder(planId: number, folderId: number | null) {
    startTransition(async () => {
      await moveReservePlan(planId, folderId, clientId, projectId);
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
  // Per-field messages from a zodError (e.g. description past MAX_NOTE_LENGTH,
  // a GPS coordinate out of range) — kept alongside editorError rather than
  // instead of it, since a refusal that isn't attached to any one field (a
  // capability/scope check) only ever comes back as the generic message.
  const [editorFieldErrors, setEditorFieldErrors] = useState<Record<string, string> | undefined>(undefined);
  const [confirmDeleteReserve, setConfirmDeleteReserve] = useState(false);

  function resetEditorFields(r?: Reserve) {
    setDescription(r?.description ?? "");
    setStatus(r?.status ?? "OPEN");
    setLat(r?.latitude != null ? String(r.latitude) : "");
    setLng(r?.longitude != null ? String(r.longitude) : "");
    setEditorError(null);
    setEditorFieldErrors(undefined);
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

  function openReserve(reserve: ReserveWithPhotos) {
    resetEditorFields(reserve);
    setEditor({ mode: "edit", reserveId: reserve.id, number: reserve.number });
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
        setEditorFieldErrors(res.type === "zodError" ? res.fieldsForm : undefined);
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
  // upload/delete (the `editor` only holds its id + number, never a stale copy).
  const editingReserve =
    editor?.mode === "edit" ? selectedPlan?.reserves.find((r) => r.id === editor.reserveId) : undefined;
  const photos = editingReserve?.photos ?? [];

  const pinColor = (s: ReserveStatus) =>
    s === "RESOLVED"
      ? "bg-green-600 border-white dark:border-gray-900"
      : "bg-rose-600 border-white dark:border-gray-900";

  return (
    <div className="flex flex-col">
      {/* Breadcrumb — same navigation shape as the Files module, now multi-level. */}
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-300 dark:border-gray-700 px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 sm:px-6">
        <Link
          href={folderHref(null)}
          className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200"
          aria-label={t.files.home}
        >
          <HomeIcon className="h-4 w-4" />
        </Link>
        {breadcrumb.map((crumb, i) => {
          const isLast = i === breadcrumb.length - 1;
          return (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRightIcon className="h-3.5 w-3.5" />
              {isLast ? (
                <span className="truncate text-gray-700 dark:text-gray-200">{crumb.name}</span>
              ) : (
                <Link href={folderHref(crumb.id)} className="truncate hover:text-gray-700 dark:hover:text-gray-200">
                  {crumb.name}
                </Link>
              )}
            </span>
          );
        })}
      </div>

      {/* Subfolders of this level, then the plans filed directly in it. */}
      {subfolders.length > 0 || visiblePlans.length > 0 ? (
        <ul className="divide-y divide-gray-300 dark:divide-gray-700">
          {subfolders.map((f) => (
            <ReserveFolderRow
              key={`folder-${f.id}`}
              folder={f}
              clientId={clientId}
              projectId={projectId}
              planCount={plansInFolder(f.id).length}
              canEdit={canEdit}
            />
          ))}
          {visiblePlans.map((p) => (
            <li
              key={`plan-${p.id}`}
              className={`flex items-center gap-3 px-4 py-2.5 sm:px-6 ${
                selectedPlan?.id === p.id ? "bg-blue-50 dark:bg-gray-700/40" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedPlanId(p.id)}
                aria-current={selectedPlan?.id === p.id}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm hover:opacity-80"
              >
                <MapPinIcon className="h-5 w-5 shrink-0 text-rose-500" />
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-xs text-gray-400">
                  {format(t.reserves.reserveCount, { count: p.reserves.length })}
                  {/* Total stays first (existing info, unchanged); "open" is
                      appended rather than replacing it, and only when there's
                      something to count. */}
                  {p.reserves.length > 0 && (
                    <> · {format(t.reserves.openCount, { count: summarizeReserves([p]).open })}</>
                  )}
                </span>
              </button>
              {canEdit && allFolders.length > 0 && (
                <select
                  value={p.folderId ?? ""}
                  onChange={(e) => movePlanToFolder(p.id, e.target.value ? Number(e.target.value) : null)}
                  disabled={pending}
                  aria-label={format(t.reserves.moveToFolderLabel, { name: p.name })}
                  className="hidden shrink-0 rounded border border-gray-300 bg-white p-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 sm:block"
                >
                  <option value="">{t.reserves.noFolder}</option>
                  {allFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setPlanToDelete(p)}
                  aria-label={format(t.reserves.deletePlan, { name: p.name })}
                  className="shrink-0 cursor-pointer rounded p-1 text-red-500 hover:bg-red-500/10 dark:text-red-400"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400 sm:px-6">
          {currentFolderId != null ? t.projects.detail.emptyFolder : t.reserves.noPlans}
        </div>
      )}

      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">

      {/* Plan viewer. Nothing to say when no plan is selected — the browser
          above already shows the empty state for the current level. */}
      {!selectedPlan ? null : (
        <div className="flex flex-col gap-2">
          {canEdit && <p className="text-xs text-gray-500 dark:text-gray-400">{t.reserves.addHint}</p>}
          <div className="relative select-none overflow-hidden rounded border border-gray-300 dark:border-gray-700">
            {planImgFailed ? (
              // Degrade like ClientAvatar does on a failed photo: no broken
              // image icon, an explanation plus a way to try again — the
              // pins below aren't shown either, since they're only
              // meaningful pinned on the plan they're missing here.
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 bg-gray-100 px-4 py-10 text-center text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <PhotoIcon className="h-8 w-8" />
                <p>{t.reserves.planImageError}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">{t.reserves.planUnavailableHint}</p>
                <button
                  type="button"
                  onClick={() => setPlanImgFailed(false)}
                  className="inline-flex min-h-11 items-center rounded border border-gray-300 px-3 text-xs font-medium hover:bg-[#d1d5dc] dark:border-gray-600 dark:hover:bg-gray-700 cursor-pointer"
                >
                  {t.common.retry}
                </button>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={assetPath("reserve-plans", selectedPlan.id, { width: 1600 })}
                alt={selectedPlan.name}
                onClick={handlePlanClick}
                onError={() => {
                  setPlanImgFailed(true);
                  setPlanImgFailedFor(selectedPlan.id);
                }}
                className={`block w-full ${canEdit ? "cursor-crosshair" : ""}`}
              />
            )}
            {!planImgFailed && selectedPlan.reserves.map((reserve) => (
              <button
                key={reserve.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openReserve(reserve);
                }}
                style={{ left: `${reserve.x * 100}%`, top: `${reserve.y * 100}%` }}
                aria-label={`${reserve.number} — ${reserve.description}`}
                title={reserve.description}
                className="absolute -translate-x-1/2 -translate-y-full cursor-pointer"
              >
                {/* Teardrop map marker: round head, sharp corner rotated to a
                    downward tip that sits on the exact spot. */}
                <span
                  className={`flex h-6 w-6 rotate-45 items-center justify-center rounded-full rounded-bl-none border-2 text-xs font-bold text-white shadow ${pinColor(reserve.status)}`}
                >
                  <span className="-rotate-45">{reserve.number}</span>
                </span>
              </button>
            ))}
            {!planImgFailed && editor?.mode === "new" && (
              <span
                style={{ left: `${editor.x * 100}%`, top: `${editor.y * 100}%` }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-full"
              >
                <span className="block h-6 w-6 rotate-45 animate-pulse rounded-full rounded-bl-none border-2 border-white bg-rose-600/70 dark:border-gray-900" />
              </span>
            )}
          </div>

          {/* Textual list of this plan's réserves — deliberately OUTSIDE the
              planImgFailed check above: this is the whole point of the
              feature. When the plan image can't load, the numbers,
              descriptions, statuses and photos already sitting in `plans`
              stay reachable here instead of disappearing along with the
              pins. */}
          <div className="flex flex-col gap-2">
            {/* An "open only" filter only makes sense once there's something
                to filter — an empty plan showed it anyway, a command over an
                empty set. */}
            {selectedPlanReserves.length > 0 && (
              <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={openOnly}
                  onChange={(e) => setOpenOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary dark:border-gray-600"
                />
                {t.reserves.openOnlyFilter}
              </label>
            )}
            {filteredReserves.length === 0 ? (
              <p className="px-1 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                {openOnly ? t.reserves.noOpenReserves : t.reserves.noReserves}
              </p>
            ) : (
              <ul className="divide-y divide-gray-300 dark:divide-gray-700 rounded border border-gray-300 dark:border-gray-700">
                {filteredReserves.map((reserve) => (
                  <li key={reserve.id}>
                    <button
                      type="button"
                      onClick={() => openReserve(reserve)}
                      aria-label={`${reserve.number} — ${reserve.description} — ${t.reserves.status[reserve.status]}${
                        reserve.photos.length > 0
                          ? ` — ${format(t.reserves.photoCount, { count: reserve.photos.length })}`
                          : ""
                      }`}
                      // The description is what gets visually truncated on this
                      // row (unlike the pin marker on the plan, which never
                      // shows the text at all) — same native-tooltip escape
                      // hatch the pin already has via its own `title`.
                      title={reserve.description}
                      className="flex min-h-11 w-full cursor-pointer flex-col items-start gap-1 px-3 py-2.5 text-left hover:bg-gray-500/10 sm:flex-row sm:items-center sm:gap-3"
                    >
                      {/* Same round marker as the pin on the plan (pinColor),
                          just not positioned absolutely — number and status
                          are re-announced via aria-label above (unlike the
                          pin marker, which only names the number) since this
                          list's whole point is to carry the status too when
                          the plan image can't. */}
                      <span
                        aria-hidden="true"
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${pinColor(reserve.status)}`}
                      >
                        {reserve.number}
                      </span>
                      {/* Own line on mobile (w-full) — squeezed to ~18 chars
                          otherwise, with no way to read the rest. Back to a
                          single row with the marker/badge/photo count from
                          sm: up (sm:w-auto sm:flex-1). */}
                      <span className="w-full min-w-0 truncate text-sm text-gray-900 dark:text-gray-100 sm:w-auto sm:flex-1">
                        {reserve.description}
                      </span>
                      <ReserveStatusBadge status={reserve.status} />
                      {reserve.photos.length > 0 && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <PhotoIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          {reserve.photos.length}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Réserve editor modal */}
      <ModalShell
        open={editor !== null}
        onClose={closeEditor}
        title={
          editor?.mode === "edit"
            ? `${t.reserves.editReserveTitle} n°${editor.number}`
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
            {editorFieldErrors?.description && (
              <p className="mt-1 text-xs text-red-500">{editorFieldErrors.description}</p>
            )}
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
            {editorFieldErrors?.latitude && <p className="mt-1 text-xs text-red-500">{editorFieldErrors.latitude}</p>}
            {editorFieldErrors?.longitude && (
              <p className="mt-1 text-xs text-red-500">{editorFieldErrors.longitude}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t.reserves.photosHeading}
            </label>
            {editor?.mode === "edit" ? (
              <div className="flex flex-wrap gap-2">
                {photos.map((p, i) => (
                  <ReservePhotoThumbnail
                    key={p.id}
                    photoId={p.id}
                    alt={format(t.reserves.photoAlt, { index: i + 1, number: editor.number })}
                    canEdit={canEdit}
                    pending={pending}
                    onDelete={removePhoto}
                  />
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
      </div>
    </div>
  );
}

/**
 * One réserve photo thumbnail, in its own component so its `failed` state is
 * scoped to that one photo (React keeps state per instance, keyed by `key`
 * above) rather than to the whole grid — the same self-contained
 * load-then-degrade pattern as ClientAvatar. `pending` disables the delete
 * button while any réserve mutation is in flight, exactly like the inline
 * version this replaces.
 */
function ReservePhotoThumbnail({
  photoId,
  alt,
  canEdit,
  pending,
  onDelete,
}: {
  photoId: number;
  alt: string;
  canEdit: boolean;
  pending: boolean;
  onDelete: (id: number) => void;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative">
      {failed ? (
        <div className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded border border-gray-300 bg-gray-100 text-center dark:border-gray-700 dark:bg-gray-800">
          <PhotoIcon className="h-4 w-4 text-gray-400" />
          <span className="px-1 text-xs leading-tight text-gray-400">{t.reserves.photoImageError}</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={assetPath("reserve-photos", photoId, { width: 128 })}
          alt={alt}
          onError={() => setFailed(true)}
          className="h-16 w-16 rounded border border-gray-300 object-cover dark:border-gray-700"
        />
      )}
      {canEdit && (
        // The visible control stays a 16px dot so the 64px thumbnail doesn't
        // balloon, but the actual button is a 44px hit target centered on
        // that same dot (touch target minimum) via an invisible wrapper.
        <button
          type="button"
          onClick={() => onDelete(photoId)}
          disabled={pending}
          aria-label={t.reserves.deletePhoto}
          className="absolute -right-5 -top-5 flex h-11 w-11 cursor-pointer items-center justify-center disabled:opacity-50"
        >
          <span className="rounded-full bg-red-600 p-0.5 text-white shadow hover:bg-red-700">
            <XMarkIcon className="h-3 w-3" />
          </span>
        </button>
      )}
    </div>
  );
}
