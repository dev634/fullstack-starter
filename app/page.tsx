import Title from "@/components/Title";

export default function HomePage() {
  return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-4xl space-y-4">
          <Title title="Fullstack Starter" />
          <p className="text-sm text-zinc-600"> Semaine 1 : Next.js + Prisma + Docker Compose + PostgreSQL + GitHub CI</p>
        </div>
      </main>

  );
}
