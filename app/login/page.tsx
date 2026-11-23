import LoginForm from "@/forms/LoginForm";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/** The only `?raison=` value the page understands (actions/users/users.ts::updateUser sets it). */
const CREDENTIALS_CHANGED = "identifiants-modifies";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ raison?: string | string[] }> }) {
  const t = getDictionary(await getLocale());
  const { raison } = await searchParams;
  // Any other value (unknown, repeated, absent) shows nothing.
  const credentialsChanged = raison === CREDENTIALS_CHANGED;
  return (
    <main className="flex flex-1 min-h-0 flex-col justify-center overflow-y-auto py-8">
      <div className="w-full max-w-sm mx-auto space-y-4 px-6">
        <h1 className="text-3xl font-bold mb-6">{t.auth.loginTitle}</h1>
        {credentialsChanged && (
          <p role="status" className="text-sm text-gray-700 dark:text-gray-300">
            {t.auth.credentialsChanged}
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
