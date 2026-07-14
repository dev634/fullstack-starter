"use client";
import { useEffect, useActionState } from "react";
import { useRouter } from "next/navigation";
import { resetPassword } from "@/actions/auth/auth";
import { Input } from "@/components/Inputs";
import { Toast } from "@/components/Toast";
import { useTranslation } from "@/components/LocaleProvider";
import type { AuthActionState } from "@/types/auth";

const initialState: AuthActionState = {
  type: null,
  message: "",
};

export default function ResetPasswordForm({ token }: { token: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<AuthActionState, FormData>(
    resetPassword,
    initialState
  );

  useEffect(() => {
    if (state.type !== "success") return;
    const timer = setTimeout(() => router.push("/login"), 2000);
    return () => clearTimeout(timer);
  }, [state, router]);

  return (
    <form action={formAction} className="w-full bg-transparent rounded shadow">
      <Toast type={state.type} message={state.message} />
      <input type="hidden" name="token" value={token} />
      <Input
        label={t.auth.newPassword}
        name="password"
        type="password"
        error={state.type === "zodError" ? state.fieldsForm : undefined}
      />
      <Input
        label={t.auth.confirmPassword}
        name="confirmPassword"
        type="password"
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
        {t.auth.resetPassword}
      </button>
    </form>
  );
}
