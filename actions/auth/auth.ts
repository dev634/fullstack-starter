"use server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";
import { formDataToObject } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { isRateLimited, registerFailure, clearRateLimit } from "@/lib/rate-limit";
import { sendPasswordResetEmail } from "@/lib/email";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { format } from "@/lib/i18n/format";
import {
  loginSchema,
  requestResetSchema,
  resetPasswordSchema,
  type LoginInput,
  type RequestResetInput,
  type ResetPasswordInput,
} from "@/schemas/auth";
import {
  findByEmail,
  createResetToken,
  findValidResetToken,
  markResetTokenUsed,
  updatePassword,
} from "@/repository/users";
import type { AuthActionState } from "@/types/auth";

const LOGIN_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 };
const RESET_REQUEST_LIMIT = { limit: 3, windowMs: 15 * 60 * 1000 };
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export async function login(
  prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const t = getDictionary(await getLocale());
  const credentials = formDataToObject(formData) as LoginInput;

  const parsed = loginSchema.safeParse(credentials);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  // Throttle repeated failed sign-ins for the same email.
  const rlKey = `login:${parsed.data.email.toLowerCase()}`;
  const rl = isRateLimited(rlKey, LOGIN_LIMIT);
  if (rl.limited) {
    return {
      ...prevState,
      type: "error",
      message: format(t.auth.tooManyAttempts, { minutes: Math.ceil(rl.retryAfterMs / 60000) }),
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
        message: t.auth.invalidCredentials,
      };
    }
    throw error;
  }

  // Unreachable on success (signIn redirects), but clears the counter if a
  // caller ever passes redirect:false.
  clearRateLimit(rlKey);
  return prevState;
}

/**
 * Public base URL used to build the reset link. Prefers the pinned
 * AUTH_URL (set in production, see docs/deploy-hostinger.md); falls back to
 * the incoming request's forwarded host for local dev.
 */
async function getBaseUrl(): Promise<string> {
  if (process.env.AUTH_URL) return process.env.AUTH_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * Request a password reset link. Always resolves with the same generic
 * message regardless of whether the email exists or was rate-limited, so a
 * caller can't use this to enumerate accounts.
 */
export async function requestPasswordReset(
  prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const t = getDictionary(await getLocale());
  const data = formDataToObject(formData) as RequestResetInput;
  const parsed = requestResetSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  const email = parsed.data.email.toLowerCase();
  const rlKey = `reset:${email}`;
  const rl = isRateLimited(rlKey, RESET_REQUEST_LIMIT);

  if (!rl.limited) {
    registerFailure(rlKey, RESET_REQUEST_LIMIT);
    const user = await findByEmail(email);
    if (user) {
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await createResetToken(user.id, token, expiresAt);
      const resetUrl = `${await getBaseUrl()}/reset-password?token=${token}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    }
  }

  return { ...prevState, type: "success", message: t.auth.resetLinkSent };
}

/** Consume a reset token and set the new password. */
export async function resetPassword(
  prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const t = getDictionary(await getLocale());
  const data = formDataToObject(formData) as ResetPasswordInput;
  const parsed = resetPasswordSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ...prevState,
      type: "zodError",
      message: t.errors.validationError,
      fieldsForm: makeObjectFromZodError(parsed.error, t),
    };
  }

  const record = await findValidResetToken(parsed.data.token);
  if (!record) {
    return {
      ...prevState,
      type: "error",
      message: t.auth.resetLinkInvalidOrExpired,
    };
  }

  const hashed = await bcrypt.hash(parsed.data.password, 10);
  await updatePassword(record.userId, hashed);
  await markResetTokenUsed(record.id);

  return { ...prevState, type: "success", message: t.auth.passwordUpdated };
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}
