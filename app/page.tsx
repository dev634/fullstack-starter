import Text from "@/components/Text";
import Title from "@/components/Title";

export default function HomePage() {
  return (
      <main className="min-h-screen py-8">
        <div className="w-8/12 mx-auto space-y-4">
          <Title title="Fullstack Starter" />
          <Text text={"This is a starter template for building fullstack applications with Next.js, Prisma, Docker Compose, PostgreSQL, and GitHub CI. It provides a solid foundation for building scalable and maintainable applications."}/>
        </div>
      </main>

  );
}
