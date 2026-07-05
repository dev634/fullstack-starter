import LoginForm from "@/forms/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex flex-1 min-h-0 flex-col justify-center overflow-y-auto py-8">
      <div className="w-full max-w-sm mx-auto space-y-4 px-6">
        <h1 className="text-3xl font-bold mb-6">Connexion</h1>
        <LoginForm />
      </div>
    </main>
  );
}
