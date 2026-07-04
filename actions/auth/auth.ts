"use server";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";
import { formDataToObject } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { isRateLimited, registerFailure, clearRateLimit } from "@/lib/rate-limit";
import { loginSchema, type LoginInput } from "@/schemas/auth";
import type { AuthActionState } from "@/types/auth";

const LOGIN_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };

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

  // Throttle repeated failed sign-ins for the same email.
  const rlKey = `login:${parsed.data.email.toLowerCase()}`;
  const rl = isRateLimited(rlKey, LOGIN_LIMIT);
  if (rl.limited) {
    return {
      ...prevState,
      type: "error",
      message: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterMs / 60000)} min.`,
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
      registerFailure(rlKey, LOGIN_LIMIT);
      return {
        ...prevState,
        type: "error",
        message: "Invalid email or password.",
      };
    }
    throw error;
  }

  // Unreachable on success (signIn redirects), but clears the counter if a
  // caller ever passes redirect:false.
  clearRateLimit(rlKey);
  return prevState;
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
