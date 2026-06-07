"use server";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";
import { formDataToObject } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { loginSchema, type LoginInput } from "@/schemas/auth";
import type { AuthActionState } from "@/types/auth";

export async function login(
  prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const credentials = formDataToObject(formData) as LoginInput;

  const parsed = loginSchema.safeParse(credentials);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: "Validation error. Please check your input and try again.",
      fieldsForm: makeObjectFromZodError(parsed.error),
    };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/clients",
    });
  } catch (error) {
    // A successful sign-in throws a NEXT_REDIRECT error that must bubble up
    // so Next.js can perform the redirect — only AuthError means a real failure.
    if (error instanceof AuthError) {
      return {
        ...prevState,
        type: "error",
        message: "Invalid email or password.",
      };
    }
    throw error;
  }

  return prevState;
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
