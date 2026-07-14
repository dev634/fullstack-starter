"use client";
import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadLogo, removeLogo } from "@/actions/appSettings/appSettings";
import { Toast } from "@/components/Toast";
import { useTranslation } from "@/components/LocaleProvider";
import type { AppSettingsActionState } from "@/types/appSettings";

const initialState: AppSettingsActionState = {
  type: null,
  message: "",
};

type LogoUploadFormProps = {
  logoUrl: string | null;
};

export default function LogoUploadForm({ logoUrl }: LogoUploadFormProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<AppSettingsActionState, FormData>(
    uploadLogo,
    initialState
  );
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    formRef.current?.requestSubmit();
  }

  async function handleRemove() {
    setRemoveError(null);
    setRemoving(true);
    const result = await removeLogo();
    setRemoving(false);
    if (result.type === "error") {
      setRemoveError(result.message);
      return;
    }
    setPreview(null);
    router.refresh();
  }

  return (
    <div className="mb-7">
      <p className="mb-1 block text-sm text-gray-700 dark:text-gray-300">{t.appSettings.logoTitle}</p>
      <Toast type={state.type} message={state.message} />
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-800">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local asset next/image can optimize at build time
            <img src={preview} alt={t.appSettings.logoPreviewAlt} className="h-full w-full object-contain" />
          ) : (
            <span className="px-1 text-center text-xs text-gray-400 dark:text-gray-500">
              {t.appSettings.logoNone}
            </span>
          )}
        </div>

        <form ref={formRef} action={formAction} className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            name="logo"
            accept="image/*"
            onChange={handleChange}
            className="hidden"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={() => inputRef.current?.click()}
            className={`rounded border border-gray-300 bg-white px-4 py-2 text-gray-900 hover:bg-[#d1d5dc] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 ${
              isPending ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            }`}
          >
            {preview ? t.appSettings.changeLogo : t.appSettings.addLogo}
          </button>
          {preview && (
            <button
              type="button"
              disabled={removing}
              onClick={handleRemove}
              className={`rounded border border-red-500/40 px-4 py-2 text-red-500 hover:bg-red-500/10 dark:text-red-400 ${
                removing ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              }`}
            >
              {removing ? t.appSettings.removing : t.appSettings.removeLogo}
            </button>
          )}
        </form>
      </div>
      {removeError && (
        <p className="mt-2 text-sm text-red-500" aria-live="polite">
          {removeError}
        </p>
      )}
    </div>
  );
}
