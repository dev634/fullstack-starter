"use server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";
import { formDataToObject } from "@/lib/helpers";
import { makeObjectFromZodError } from "@/lib/zod";
import { isRateLimited, registerFailure } from "@/lib/rate-limit";
import { isLoginRateLimited } from "@/lib/loginRateLimit";
import { getClientIp } from "@/lib/clientIp";
import { sendPasswordResetEmail } from "@/lib/email";
import { getAppSettings } from "@/lib/appSettings";
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

const RESET_REQUEST_LIMIT = { limit: 3, windowMs: 15 * 60 * 1000 };
// Per-IP cap sits on top of the per-email one to blunt reset-email bombing
// across many different accounts from one source. (Login limits live in
// lib/loginRateLimit.ts, shared with the authorize() callback.)
const RESET_IP_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };
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

  // Fast-fail with a localized message before even hitting signIn()/bcrypt.
  // Read-only check — the actual enforcement (and failure recording) happens
  // once, inside authorize() (lib/auth.ts), the one choke point every
  // credentials sign-in funnels through regardless of caller.
  const rl = await isLoginRateLimited(parsed.data.email, await getClientIp());
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
      return {
        ...prevState,
        type: "error",
        message: t.auth.invalidCredentials,
      };
    }
    throw error;
  }

  return prevState;
}

/**
 * Public base URL used to build the reset link. Prefers the pinned
 * AUTH_URL (set in production, see docs/deploy-hostinger.md); falls back to
 * the incoming request's forwarded host for local dev.
 */
async function getResetBaseUrl(): Promise<string | null> {
  if (process.env.AUTH_URL) return process.env.AUTH_URL.replace(/\/$/, "");
  // No pinned URL: never trust the incoming Host header in production — it's
  // attacker-controllable and would poison the reset link (the victim would
  // receive a link to the attacker's host and leak their token). AUTH_URL is
  // required in prod; the header fallback stays a dev-only convenience.
  if (process.env.NODE_ENV === "production") return null;
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
  const ipKey = `reset-ip:${await getClientIp()}`;
  const [rl, rlIp] = await Promise.all([
    isRateLimited(rlKey, RESET_REQUEST_LIMIT),
    isRateLimited(ipKey, RESET_IP_LIMIT),
  ]);

  if (!rl.limited && !rlIp.limited) {
    await Promise.all([registerFailure(rlKey), registerFailure(ipKey)]);
    // Resolve the link base BEFORE the user lookup so timing/behaviour is the
    // same whether or not the email exists (no enumeration signal).
    const baseUrl = await getResetBaseUrl();
    const user = await findByEmail(email);
    if (user && baseUrl) {
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await createResetToken(user.id, token, expiresAt);
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;
      try {
        const settings = await getAppSettings();
        await sendPasswordResetEmail(user.email, resetUrl, {
          brand: {
            name: settings.appName,
            primaryColor: settings.primaryColor,
            logoUrl: settings.logoUrl,
          },
          strings: t.emails.passwordReset,
        });
      } catch (error) {
        // A provider outage must not escape this action. Letting it throw
        // crashed the page — and, worse, turned this form into an account
        // enumeration oracle: an unknown address returned the generic success
        // below while a known one produced a server error. The response has to
        // be identical either way, so swallow it here and log server-side.
        console.error("Password reset email failed to send:", error);
      }
    } else if (!baseUrl) {
      console.error("Password reset skipped: AUTH_URL is not set in production.");
    }
  }

  // Always the same generic response — rate-limited or not, exists or not.
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
