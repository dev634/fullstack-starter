import "dotenv/config";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";


const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
async function main() {
  const alice = await prisma.client.upsert({
    where: { email: "alice@sunrisecorp.com" },
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
    where: { email: "bob@sunrisecorp.com" },
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
  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      name: "Admin",
      role: "ADMIN",
      // Default dev password: "password123" — change it in real environments.
      password: await bcrypt.hash("password123", 10),
    },
  });
  const viewer = await prisma.user.upsert({
    where: { email: "viewer@example.com" },
    update: {},
    create: {
      email: "viewer@example.com",
      name: "Viewer",
      role: "VIEWER",
      // Default dev password: "password123" — change it in real environments.
      password: await bcrypt.hash("password123", 10),
    },
  });

  console.log({ alice, bob, admin, viewer });
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