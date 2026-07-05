"use client";
import { useActionState } from "react";
import { requestPasswordReset } from "@/actions/auth/auth";
import { Input } from "@/components/Inputs";
import { Toast } from "@/components/Toast";
import type { AuthActionState } from "@/types/auth";

const initialState: AuthActionState = {
  type: null,
  message: "",
};

export default function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState<AuthActionState, FormData>(
    requestPasswordReset,
    initialState
  );

  return (
    <form action={formAction} className="w-full bg-transparent rounded shadow">
      <Toast type={state.type} message={state.message} />
      <Input
        label="Email"
        name="email"
        type="email"
        error={state.type === "zodError" ? state.fieldsForm : undefined}
      />
      <button
        type="submit"
        disabled={isPending}
        className={`w-full px-4 py-2 bg-blue-500 text-white
        rounded hover:bg-blue-600 cursor-pointer ${
          isPending ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        Envoyer le lien de réinitialisation
      </button>
    </form>
  );
}
