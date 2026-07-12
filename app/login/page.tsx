import LoginForm from "@/forms/LoginForm";
import { getLocale } from "@/lib/i18n/getLocale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function LoginPage() {
  const t = getDictionary(await getLocale());
  return (
    <main className="flex flex-1 min-h-0 flex-col justify-center overflow-y-auto py-8">
      <div className="w-full max-w-sm mx-auto space-y-4 px-6">
        <h1 className="text-3xl font-bold mb-6">{t.auth.loginTitle}</h1>
        <LoginForm />
      </div>
    </main>
  );
}
