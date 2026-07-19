'use client'
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CameraIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { scanDeliveryNote, applyDeliveryNoteScan } from "@/actions/deliveryNoteScan/deliveryNoteScan";
import type { ScannedItem } from "@/types/deliveryNoteScan";

export type MaterialMatchOption = { id: number; name: string };

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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setRows(null);
    setSupplier("");
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
      setSupplier(res.supplier ?? "");
      setRows(
        res.items.map((item) => {
          const match = materials.find((m) => m.name.trim().toLowerCase() === item.name.trim().toLowerCase());
          return { ...item, materialId: match?.id ?? null };
        })
      );
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
      fd.set("items", JSON.stringify(rows));
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
              {t.materials.scan.title}
            </h2>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {!rows ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-gray-600 dark:text-gray-300">{t.materials.scan.instructions}</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    capture="environment"
                    aria-label={t.materials.scan.chooseFile}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="text-sm text-gray-500 dark:text-gray-400 file:mr-3 file:rounded file:border-0 file:bg-gray-100 dark:file:bg-gray-700 file:px-3 file:py-1.5 file:text-sm file:text-gray-900 dark:file:text-gray-100 file:cursor-pointer"
                  />
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
                    {rows.map((row, i) => (
                      <li key={i} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                        <select
                          value={row.materialId ?? ""}
                          onChange={(e) => updateRow(i, { materialId: e.target.value ? Number(e.target.value) : null })}
                          aria-label={t.materials.scan.matchLabel}
                          className="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
                        >
                          <option value="">{t.materials.scan.newMaterialOption} : {row.name}</option>
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
                          className="w-20 shrink-0 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100"
                        />
                        <input
                          type="text"
                          value={row.unit ?? ""}
                          onChange={(e) => updateRow(i, { unit: e.target.value || null })}
                          placeholder={t.materials.unitPlaceholder}
                          aria-label={t.materials.unitLabel}
                          className="w-20 shrink-0 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
                        />
                        <input
                          type="text"
                          value={row.reference ?? ""}
                          onChange={(e) => updateRow(i, { reference: e.target.value || null })}
                          placeholder={t.materials.referencePlaceholder}
                          aria-label={t.materials.referenceLabel}
                          className="w-24 shrink-0 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
                        />
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          aria-label={t.materials.scan.removeRow}
                          className="shrink-0 cursor-pointer self-end rounded p-1 text-red-500 hover:bg-red-500/10 dark:text-red-400 sm:self-auto"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
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
                onClick={close}
                className="rounded bg-gray-100 px-4 py-2 font-bold text-gray-900 hover:bg-[#d1d5dc] dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 cursor-pointer"
              >
                {t.common.cancel}
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
              ) : (
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={rows.length === 0 || pending}
                  className={`rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${
                    rows.length === 0 || pending ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                >
                  {pending ? t.materials.scan.applying : t.materials.scan.apply}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
