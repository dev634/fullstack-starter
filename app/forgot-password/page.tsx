import ForgotPasswordForm from "@/forms/ForgotPasswordForm";
import Link from "next/link";

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 min-h-0 flex-col justify-center overflow-y-auto py-8">
      <div className="w-full max-w-sm mx-auto space-y-4 px-6">
        <h1 className="text-3xl font-bold mb-2">Mot de passe oublié</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Indique ton email, on t&apos;envoie un lien pour choisir un nouveau mot de passe.
        </p>
        <ForgotPasswordForm />
        <Link href="/login" className="block text-center text-sm text-gray-500 dark:text-gray-400 hover:underline">
          Retour à la connexion
        </Link>
      </div>
    </main>
  );
}
