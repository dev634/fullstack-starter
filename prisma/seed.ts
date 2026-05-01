import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";


const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
async function main() {
  const alice = await prisma.client.upsert({
    where: { email: "alice@prisma.io" },
    update: {},
    create: {
      email: "alice@sunrisecorp.com",
      companyName: "Sunrise Corporation",
      firstName: "Alice",
      lastName: "Smith",
      address: "123 Main St, Anytown, USA",
      country: "USA",
      city: "New York",
      zipCode: "10001",
    },
  });
    const bob = await prisma.client.upsert({
    where: { email: "bob@prisma.io" },
    update: {},
    create: {
      email: "bob@sunrisecorp.com",
      companyName: "Sunrise Corporation",
      firstName: "Bob",
      lastName: "Johnson",
      address: "456 Oak Ave, Anothercity, USA",
      country: "USA",
      city: "New York",
      zipCode: "10001",
    },
  });
  console.log({ alice, bob});
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });