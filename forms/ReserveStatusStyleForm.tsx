"use client";
import { useActionState, useState } from "react";
import { SwatchIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "@/components/LocaleProvider";
import { format } from "@/lib/i18n/format";
import { updateReserveStatusStyle } from "@/actions/reserves/reserves";
import ModalShell from "@/components/ModalShell";
import ColorPickerInput from "@/components/ColorPickerInput";
import { resolveReserveStatusStyle, type ReserveStatusStyleSource } from "@/lib/reserveStatusStyle";
import { MAX_NAME_LENGTH } from "@/schemas/fields";
import type { ReserveStatusStyleActionState } from "@/types/reserve";

const initialState: ReserveStatusStyleActionState = {
  type: null,
  message: "",
};

/**
 * "Réglages" button for the Réserves section header — configures this
 * project's OPEN/RESOLVED label + colour (updateReserveStatusStyle,
 * actions/reserves/reserves.ts). Placed next to the section's other header
 * commands (AddReserveFolderForm/AddReservePlanForm in
 * app/clients/[id]/projects/[projectId]/page.tsx), not in a separate
 * settings screen or the project action bar — it configures the section it
 * sits on, so it lives there.
 *
 * `canEdit` is a rendering convenience, same as its header siblings: the
 * REAL gate is the server action's own requireCapability/requireAreaAccess/
 * requireSectionAccess/requireProjectAccess chain, unaffected by whether
 * this button is shown.
 */
export default function ReserveStatusStyleForm({
  clientId,
  projectId,
  project,
}: {
  clientId: number;
  projectId: number;
  project: ReserveStatusStyleSource;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<ReserveStatusStyleActionState, FormData>(
    updateReserveStatusStyle,
    initialState
  );

  // Legal: this component's OWN `open` state, adjusted during render from a
  // prop-free comparison — not a callback from props (docs/CONVENTIONS.md,
  // "Formulaires (modales)"). ModalShell demounts its children on close, so
  // the fields below always remount (and re-read `project`) fresh the next
  // time this flips true — never a stale value left over from a previous
  // open/cancel cycle.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state.type === "success") setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-1.5 text-xs font-medium hover:bg-[#d1d5dc] dark:hover:bg-gray-600 cursor-pointer"
      >
        <SwatchIcon className="h-3.5 w-3.5" />
        {t.reserves.statusStyle.configureButton}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={t.reserves.statusStyle.modalTitle}>
        <ReserveStatusStyleFields
          clientId={clientId}
          projectId={projectId}
          project={project}
          formAction={formAction}
          isPending={isPending}
          state={state}
          onCancel={() => setOpen(false)}
        />
      </ModalShell>
    </>
  );
}

function ReserveStatusStyleFields({
  clientId,
  projectId,
  project,
  formAction,
  isPending,
  state,
  onCancel,
}: {
  clientId: number;
  projectId: number;
  project: ReserveStatusStyleSource;
  formAction: (formData: FormData) => void;
  isPending: boolean;
  state: ReserveStatusStyleActionState;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // The product default for each status — used ONLY for the placeholder/hint
  // text below, never as the field's own initial value: pre-filling an
  // unconfigured field with the default would make it look like a deliberate
  // choice, exactly what the NULL-means-"not configured" column (migration
  // 20260823090000) exists to avoid.
  const defaults = resolveReserveStatusStyle(
    { reserveOpenLabel: null, reserveOpenColor: null, reserveResolvedLabel: null, reserveResolvedColor: null },
    t.reserves.status
  );

  // Read at mount from the raw (possibly-null) columns — "" when unconfigured,
  // never the resolved default. Declared here rather than in the always-mounted
  // parent so every fresh open (ModalShell remounts this on open) starts from
  // the project's CURRENT server truth, not a leftover edit from a cancelled
  // previous open.
  const [openLabel, setOpenLabel] = useState(project.reserveOpenLabel ?? "");
  const [openColor, setOpenColor] = useState(project.reserveOpenColor ?? "");
  const [resolvedLabel, setResolvedLabel] = useState(project.reserveResolvedLabel ?? "");
  const [resolvedColor, setResolvedColor] = useState(project.reserveResolvedColor ?? "");

  const fieldErrors = state.type === "zodError" ? state.fieldsForm : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="projectId" value={projectId} />
      <p className="text-xs text-gray-500 dark:text-gray-400">{t.reserves.statusStyle.intro}</p>

      <StatusStyleFieldset
        legend={t.reserves.statusStyle.openSectionTitle}
        labelName="openLabel"
        colorName="openColor"
        labelValue={openLabel}
        onLabelChange={setOpenLabel}
        colorValue={openColor}
        onColorChange={setOpenColor}
        defaultLabel={defaults.open.label}
        defaultColor={defaults.open.color}
        labelError={fieldErrors?.openLabel}
        colorError={fieldErrors?.openColor}
      />
      <StatusStyleFieldset
        legend={t.reserves.statusStyle.resolvedSectionTitle}
        labelName="resolvedLabel"
        colorName="resolvedColor"
        labelValue={resolvedLabel}
        onLabelChange={setResolvedLabel}
        colorValue={resolvedColor}
        onColorChange={setResolvedColor}
        defaultLabel={defaults.resolved.label}
        defaultColor={defaults.resolved.color}
        labelError={fieldErrors?.resolvedLabel}
        colorError={fieldErrors?.resolvedColor}
      />

      {state.type === "error" && <p className="text-xs text-red-500">{state.message}</p>}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded bg-gray-100 px-4 py-2 font-bold text-gray-900 hover:bg-[#d1d5dc] dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 cursor-pointer"
        >
          {t.common.cancel}
        </button>
        <button
          type="submit"
          disabled={isPending}
          className={`min-h-11 rounded bg-primary px-4 py-2 font-bold text-white hover:bg-primary/90 cursor-pointer ${
            isPending ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          {t.common.save}
        </button>
      </div>
    </form>
  );
}

/** One status's label + colour fields, each independently resettable to the
 * product default (emptied, per updateReserveStatusStyleSchema — an absent
 * or blank field resolves to NULL, never the empty string). Used exactly
 * twice (OPEN, RESOLVED) — kept private to this file rather than a shared
 * component, since nothing else renders this shape. */
function StatusStyleFieldset({
  legend,
  labelName,
  colorName,
  labelValue,
  onLabelChange,
  colorValue,
  onColorChange,
  defaultLabel,
  defaultColor,
  labelError,
  colorError,
}: {
  legend: string;
  labelName: string;
  colorName: string;
  labelValue: string;
  onLabelChange: (value: string) => void;
  colorValue: string;
  onColorChange: (value: string) => void;
  defaultLabel: string;
  defaultColor: string;
  labelError?: string;
  colorError?: string;
}) {
  const { t } = useTranslation();
  const isLabelConfigured = labelValue.trim() !== "";
  const isColorConfigured = colorValue.trim() !== "";

  return (
    <fieldset className="rounded border border-gray-300 p-3 dark:border-gray-700">
      <legend className="px-1 text-sm font-medium text-gray-700 dark:text-gray-300">{legend}</legend>
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor={labelName} className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
            {t.reserves.statusStyle.labelFieldLabel}
          </label>
          <input
            id={labelName}
            type="text"
            name={labelName}
            value={labelValue}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder={format(t.reserves.statusStyle.labelPlaceholder, { label: defaultLabel })}
            maxLength={MAX_NAME_LENGTH}
            className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
            <span>
              {isLabelConfigured
                ? t.reserves.statusStyle.customLabelSet
                : format(t.reserves.statusStyle.usingDefaultLabel, { label: defaultLabel })}
            </span>
            {isLabelConfigured && (
              <button
                type="button"
                onClick={() => onLabelChange("")}
                className="inline-flex min-h-11 items-center font-medium text-primary hover:underline cursor-pointer"
              >
                {t.reserves.statusStyle.resetToDefault}
              </button>
            )}
          </div>
          {labelError && <p className="mt-1 text-xs text-red-500">{labelError}</p>}
        </div>

        <div>
          <ColorPickerInput
            label={t.reserves.statusStyle.colorFieldLabel}
            name={colorName}
            value={colorValue}
            onChange={onColorChange}
            error={colorError}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
            <span
              aria-hidden="true"
              className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-gray-300 dark:border-gray-600"
              style={{ backgroundColor: isColorConfigured ? colorValue : defaultColor }}
            />
            <span>
              {isColorConfigured
                ? `${t.reserves.statusStyle.customColorSet} (${colorValue})`
                : `${t.reserves.statusStyle.usingDefaultColor} (${defaultColor})`}
            </span>
            {isColorConfigured && (
              <button
                type="button"
                onClick={() => onColorChange("")}
                className="inline-flex min-h-11 items-center font-medium text-primary hover:underline cursor-pointer"
              >
                {t.reserves.statusStyle.resetToDefault}
              </button>
            )}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
