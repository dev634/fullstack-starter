"use client";
import { useActionState, useEffect, useRef, useState } from "react";
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

  // setProperty via une ref plutot qu un attribut style : la manipulation
  // programmatique du CSSOM n est pas couverte par style-src, contrairement
  // au markup. C est le seul mecanisme qui suive une saisie au clavier tout
  // en respectant la CSP — un <style nonce> est rendu par le serveur et ne
  // peut pas etre reecrit a chaque frappe.
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    el.style.setProperty("--preview-primary", preview.primaryColor);
    el.style.setProperty("--preview-accent", preview.accentColor);
  }, [preview.primaryColor, preview.accentColor]);

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
        {/* Les couleurs passent par des variables CSS posees via le CSSOM,
            jamais par un attribut style. La CSP est
            "style-src self nonce-..." sans unsafe-inline, et un nonce autorise
            un ELEMENT <style>, jamais un ATTRIBUT — l apercu restait donc
            incolore au premier rendu et ne s animait qu a la premiere frappe,
            quand React repassait par le CSSOM (que la CSP, elle, n interdit
            pas). Voir docs/CONVENTIONS.md, section Couleurs dynamiques et CSP.
            Le repli des deux variables est --primary/--accent, deja injectees
            globalement par app/layout.tsx : avant hydratation l apercu montre
            donc les couleurs ENREGISTREES, pas une valeur en dur. */}
        <div ref={previewRef} className="flex flex-wrap items-center gap-3">
          <span className="font-bold">{preview.appName}</span>
          <button
            type="button"
            tabIndex={-1}
            className="rounded bg-[var(--preview-primary,var(--primary))] px-4 py-2 text-white"
          >
            {t.appSettings.previewButton}
          </button>
          <span className="font-medium text-[var(--preview-accent,var(--accent))] underline">
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
