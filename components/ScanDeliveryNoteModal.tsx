'use client'
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CameraIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { scanDeliveryNote, applyDeliveryNoteScan } from "@/actions/deliveryNoteScan/deliveryNoteScan";
import { composeMaterialName } from "@/lib/materialName";
import type { ScannedItem } from "@/types/deliveryNoteScan";

export type MaterialMatchOption = { id: number; name: string; supplierName: string | null; reference: string | null };

// A scanned row, extended with the admin's reviewed match: materialId set
// means "add to this existing material's stock", null means "create a new
// material with this name" — same convention the server action expects.
type ReviewRow = ScannedItem & { materialId: number | null };

export default function ScanDeliveryNoteModal({
  clientId,
  projectId,
  materials,
}: {
  clientId: number;
  projectId: number;
  materials: MaterialMatchOption[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  // Note-level supplier read from the bulletin header, editable before apply.
  const [supplier, setSupplier] = useState("");
  // Second step gate: the review shows a summary the admin must confirm
  // before any stock is touched.
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Option A auto-match: a scanned line is added to an existing material only
  // when it shares the SAME reference AND the SAME (note-level) supplier —
  // a strong identity. A line with no reference never auto-merges (it would
  // be unsafe to combine two unreferenced products), so it defaults to a new
  // material; the admin can still override any row via the dropdown.
  function autoMatch(item: ScannedItem, noteSupplier: string): number | null {
    const ref = item.reference?.trim().toLowerCase();
    if (!ref) return null;
    const sup = noteSupplier.trim().toLowerCase();
    const match = materials.find(
      (m) =>
        (m.reference?.trim().toLowerCase() ?? "") === ref &&
        (m.supplierName?.trim().toLowerCase() ?? "") === sup
    );
    return match?.id ?? null;
  }

  function reset() {
    setFile(null);
    setRows(null);
    setSupplier("");
    setConfirming(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function close() {
    setOpen(false);
    reset();
  }

  function handleScan() {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("file", file);
      const res = await scanDeliveryNote({ type: null, message: "" }, fd);
      if (res.type !== "success" || !res.items) {
        setError(res.message);
        return;
      }
      const noteSupplier = res.supplier ?? "";
      setSupplier(noteSupplier);
      setRows(res.items.map((item) => ({ ...item, materialId: autoMatch(item, noteSupplier) })));
    });
  }

  function handleApply() {
    if (!rows || !file) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("clientId", String(clientId));
      fd.set("projectId", String(projectId));
      fd.set("supplier", supplier);
      // The final name is recomposed server-side from brand + reference —
      // never trust a client-supplied name.
      fd.set(
        "items",
        JSON.stringify(
          rows.map((r) => ({
            brand: r.brand,
            reference: r.reference,
            quantity: r.quantity,
            materialId: r.materialId,
          }))
        )
      );
      fd.set("file", file);
      const res = await applyDeliveryNoteScan({ type: null, message: "" }, fd);
      if (res.type !== "success") {
        setError(res.message);
        return;
      }
      close();
      router.refresh();
    });
  }

  function updateRow(index: number, patch: Partial<ReviewRow>) {
    setRows((prev) => (prev ? prev.map((row, i) => (i === index ? { ...row, ...patch } : row)) : prev));
  }

  function removeRow(index: number) {
    setRows((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  // Confirmation summary: rows matched to an existing material are cumulated,
  // the rest are created. The predicate narrows `materialId` to `number` so
  // rendering never needs a non-null assertion.
  const mergeRows = rows?.filter((r): r is ReviewRow & { materialId: number } => r.materialId != null) ?? [];
  const newRows = rows?.filter((r) => r.materialId == null) ?? [];
  const materialName = (id: number) => materials.find((m) => m.id === id)?.name ?? "";
  // The server composes the final material name from brand + reference at
  // apply time (lib/materialName.ts); reuse that exact same pure function
  // here so the preview can never drift from what actually gets stored.
  const newMaterialLabel = (r: ReviewRow) => composeMaterialName(r.brand, r.reference);
  // A "new material" row with no brand and no reference composes down to an
  // empty name — nothing the server would accept. Caught here, before the
  // admin can even lock the review in, rather than surfacing as a generic
  // validation error after they've clicked through to confirm.
  const isInvalidNewRow = (r: ReviewRow) => r.materialId == null && newMaterialLabel(r) === "";
  const hasInvalidNewRow = rows?.some(isInvalidNewRow) ?? false;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <CameraIcon className="h-3.5 w-3.5" />
        {t.materials.scan.toggle}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <h2 className="border-b border-gray-300 px-6 py-4 text-xl font-bold text-gray-900 dark:border-gray-700 dark:text-gray-100">
              {confirming ? t.materials.scan.confirmTitle : t.materials.scan.title}
            </h2>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {!rows ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-gray-600 dark:text-gray-300">{t.materials.scan.instructions}</p>
                  {/* No `capture`: on mobile this lets the user pick an existing
                      image/document OR take a photo of the delivery note. */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    aria-label={t.materials.scan.chooseFile}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="text-sm text-gray-500 dark:text-gray-400 file:mr-3 file:rounded file:border-0 file:bg-gray-100 dark:file:bg-gray-700 file:px-3 file:py-1.5 file:text-sm file:text-gray-900 dark:file:text-gray-100 file:cursor-pointer"
                  />
                </div>
              ) : confirming ? (
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-gray-600 dark:text-gray-300">{t.materials.scan.confirmIntro}</p>
                  {mergeRows.length > 0 && (
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {format(t.materials.scan.confirmMergeHeading, { count: mergeRows.length })}
                      </h3>
                      <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-700">
                        {mergeRows.map((row, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                            <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">{materialName(row.materialId)}</span>
                            <span className="shrink-0 font-medium text-green-600 dark:text-green-400">+{row.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {newRows.length > 0 && (
                    <div>
                      <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {format(t.materials.scan.confirmNewHeading, { count: newRows.length })}
                      </h3>
                      <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm dark:divide-gray-700 dark:border-gray-700">
                        {newRows.map((row, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                            <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">{newMaterialLabel(row)}</span>
                            <span className="shrink-0 font-medium text-gray-600 dark:text-gray-300">{row.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-gray-600 dark:text-gray-300">{t.materials.scan.reviewInstructions}</p>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                      {t.materials.supplierLabel}
                    </label>
                    <input
                      type="text"
                      value={supplier}
                      onChange={(e) => setSupplier(e.target.value)}
                      placeholder={t.materials.supplierPlaceholder}
                      aria-label={t.materials.supplierLabel}
                      className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
                    />
                  </div>
                  <ul className="divide-y divide-gray-300 rounded border border-gray-300 dark:divide-gray-700 dark:border-gray-700">
                    {rows.map((row, i) => {
                      const invalid = isInvalidNewRow(row);
                      return (
                        <li
                          key={i}
                          className={`flex flex-col gap-2 p-3 ${
                            invalid ? "ring-2 ring-inset ring-red-500 dark:ring-red-400" : ""
                          }`}
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <select
                              value={row.materialId ?? ""}
                              onChange={(e) => updateRow(i, { materialId: e.target.value ? Number(e.target.value) : null })}
                              aria-label={t.materials.scan.matchLabel}
                              className="min-h-11 min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
                            >
                              <option value="">{t.materials.scan.newMaterialOption} : {newMaterialLabel(row)}</option>
                              {materials.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.quantity}
                              onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
                              aria-label={t.materials.scan.quantityLabel}
                              className="min-h-11 w-full shrink-0 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 sm:w-20"
                            />
                            <input
                              type="text"
                              value={row.brand ?? ""}
                              onChange={(e) => updateRow(i, { brand: e.target.value || null })}
                              placeholder={t.materials.brandPlaceholder}
                              aria-label={t.materials.brandLabel}
                              aria-invalid={invalid}
                              aria-describedby={invalid ? `scan-row-error-${i}` : undefined}
                              className="min-h-11 w-full shrink-0 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 sm:w-24"
                            />
                            <input
                              type="text"
                              value={row.reference ?? ""}
                              onChange={(e) => updateRow(i, { reference: e.target.value || null })}
                              placeholder={t.materials.referencePlaceholder}
                              aria-label={t.materials.referenceLabel}
                              aria-invalid={invalid}
                              aria-describedby={invalid ? `scan-row-error-${i}` : undefined}
                              className="min-h-11 w-full shrink-0 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 sm:w-24"
                            />
                            <button
                              type="button"
                              onClick={() => removeRow(i)}
                              aria-label={t.materials.scan.removeRow}
                              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center self-end rounded text-red-500 hover:bg-red-500/10 dark:text-red-400 sm:self-auto"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                          {invalid && (
                            <p id={`scan-row-error-${i}`} className="text-xs text-red-600 dark:text-red-400">
                              {t.materials.scan.missingBrandOrReference}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {rows.length === 0 && (
                    <p className="text-center text-sm text-gray-500 dark:text-gray-400">{t.materials.scan.noRows}</p>
                  )}
                </div>
              )}

              {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-300 px-6 py-4 dark:border-gray-700">
              <button
                type="button"
                onClick={() => (confirming ? setConfirming(false) : close())}
                disabled={pending}
                className="rounded bg-gray-100 px-4 py-2 font-bold text-gray-900 hover:bg-[#d1d5dc] dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {confirming ? t.materials.scan.back : t.common.cancel}
              </button>
              {!rows ? (
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={!file || pending}
                  className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${
                    !file || pending ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  {pending ? t.materials.scan.scanning : t.materials.scan.scan}
                </button>
              ) : confirming ? (
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={pending}
                  className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${
                    pending ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  {pending ? t.materials.scan.applying : t.materials.scan.confirm}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={rows.length === 0 || hasInvalidNewRow || pending}
                  className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${
                    rows.length === 0 || hasInvalidNewRow || pending ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  {t.materials.scan.apply}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
