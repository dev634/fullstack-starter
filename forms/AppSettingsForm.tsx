"use client";
import { useActionState, useState } from "react";
import { updateSettings } from "@/actions/appSettings/appSettings";
import { Input } from "@/components/Inputs";
import ColorPickerInput from "@/components/ColorPickerInput";
import { Toast } from "@/components/Toast";
import { useTranslation } from "@/components/LocaleProvider";
import type { AppSettingsActionState } from "@/types/appSettings";

const initialState: AppSettingsActionState = {
  type: null,
  message: "",
};

type AppSettingsFormProps = {
  appName: string;
  primaryColor: string;
  accentColor: string;
};

export default function AppSettingsForm({ appName, primaryColor, accentColor }: AppSettingsFormProps) {
  const { t } = useTranslation();
  const [state, formAction, isPending] = useActionState<AppSettingsActionState, FormData>(
    updateSettings,
    initialState
  );
  // Live preview reflects what's currently typed, not the saved values —
  // colors only take effect app-wide once the form is submitted.
  const [preview, setPreview] = useState({ appName, primaryColor, accentColor });

  return (
    <form action={formAction} className="w-full bg-transparent rounded shadow">
      <Toast type={state.type} message={state.message} />
      <Input
        label={t.appSettings.appNameLabel}
        name="appName"
        value={preview.appName}
        onChange={(e) => setPreview((p) => ({ ...p, appName: e.target.value }))}
        error={state.type === "zodError" ? state.fieldsForm : undefined}
      />
      <ColorPickerInput
        label={t.appSettings.primaryColorLabel}
        name="primaryColor"
        value={preview.primaryColor}
        onChange={(value) => setPreview((p) => ({ ...p, primaryColor: value }))}
        error={state.type === "zodError" ? state.fieldsForm?.primaryColor : undefined}
      />
      <ColorPickerInput
        label={t.appSettings.accentColorLabel}
        name="accentColor"
        value={preview.accentColor}
        onChange={(value) => setPreview((p) => ({ ...p, accentColor: value }))}
        error={state.type === "zodError" ? state.fieldsForm?.accentColor : undefined}
      />

      <div className="mb-7 rounded border border-gray-300 p-4 dark:border-gray-700">
        <p className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
          {t.appSettings.previewTitle}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold">{preview.appName}</span>
          <button
            type="button"
            tabIndex={-1}
            style={{ backgroundColor: preview.primaryColor }}
            className="rounded px-4 py-2 text-white"
          >
            {t.appSettings.previewButton}
          </button>
          <span style={{ color: preview.accentColor }} className="font-medium underline">
            {t.appSettings.previewLink}
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className={`w-full px-4 py-2 bg-primary text-white rounded hover:bg-primary/90 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {t.appSettings.save}
      </button>
    </form>
  );
}
