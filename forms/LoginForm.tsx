"use client";
import { useActionState, useState } from "react";
import { login } from "@/actions/auth/auth";
import { Input } from "@/components/Inputs";
import { Toast } from "@/components/Toast";
import type { AuthActionState } from "@/types/auth";

const initialState: AuthActionState = {
  type: null,
  message: "",
};

export default function LoginForm() {
  const [state, formAction, isPending] = useActionState<AuthActionState, FormData>(
    login,
    initialState
  );
  const [values, setValues] = useState({ email: "", password: "" });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <form action={formAction} className="w-full bg-transparent rounded shadow">
      <Toast type={state.type} message={state.message} />
      <Input
        label="Email"
        name="email"
        type="email"
        value={values.email}
        onChange={handleChange}
        error={state.type === "zodError" ? state.fieldsForm : undefined}
      />
      <Input
        label="Password"
        name="password"
        type="password"
        value={values.password}
        onChange={handleChange}
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
        Sign in
      </button>
    </form>
  );
}
