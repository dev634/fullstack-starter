import ResetPasswordForm from "@/forms/ResetPasswordForm";
import Link from "next/link";

type PageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className="flex flex-1 min-h-0 flex-col justify-center overflow-y-auto py-8">
        <div className="w-full max-w-sm mx-auto space-y-4 px-6 text-center">
          <h1 className="text-3xl font-bold mb-2">Lien invalide</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Ce lien de réinitialisation est incomplet.
          </p>
          <Link href="/forgot-password" className="block text-sm text-blue-600 dark:text-blue-400 hover:underline">
            Demander un nouveau lien
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 min-h-0 flex-col justify-center overflow-y-auto py-8">
      <div className="w-full max-w-sm mx-auto space-y-4 px-6">
        <h1 className="text-3xl font-bold mb-6">Nouveau mot de passe</h1>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
