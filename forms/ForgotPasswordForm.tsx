"use client";
import { useActionState } from "react";
import { requestPasswordReset } from "@/actions/auth/auth";
import { Input } from "@/components/Inputs";
import { Toast } from "@/components/Toast";
import { useTranslation } from "@/components/LocaleProvider";
import type { AuthActionState } from "@/types/auth";

const initialState: AuthActionState = {
  type: null,
  message: "",
};

export default function ForgotPasswordForm() {
  const { t } = useTranslation();
  const [state, formAction, isPending] = useActionState<AuthActionState, FormData>(
    requestPasswordReset,
    initialState
  );

  return (
    <form action={formAction} className="w-full bg-transparent rounded shadow">
      <Toast type={state.type} message={state.message} />
      <Input
        label={t.auth.email}
        name="email"
        type="email"
        error={state.type === "zodError" ? state.fieldsForm : undefined}
      />
      <button
        type="submit"
        disabled={isPending}
        className={`w-full px-4 py-2 bg-primary text-white
        rounded hover:bg-primary/90 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {t.auth.sendResetLink}
      </button>
    </form>
  );
}
