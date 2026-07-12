import ForgotPasswordForm from "@/forms/ForgotPasswordForm";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function ForgotPasswordPage() {
  const t = getDictionary(await getLocale());
  return (
    <main className="flex flex-1 min-h-0 flex-col justify-center overflow-y-auto py-8">
      <div className="w-full max-w-sm mx-auto space-y-4 px-6">
        <h1 className="text-3xl font-bold mb-2">{t.auth.forgotPasswordTitle}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {t.auth.forgotPasswordIntro}
        </p>
        <ForgotPasswordForm />
        <Link href="/login" className="block text-center text-sm text-gray-500 dark:text-gray-400 hover:underline">
          {t.auth.backToLogin}
        </Link>
      </div>
    </main>
  );
}
