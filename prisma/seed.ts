import "dotenv/config";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";


const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
/** Give an organisation a primary contact if it doesn't have one yet (idempotent seed). */
async function ensurePrimaryContact(
  clientId: number,
  data: { firstName: string; lastName: string; email?: string; phone?: string }
) {
  const existing = await prisma.contact.findFirst({ where: { clientId } });
  if (!existing) {
    // Champs listés un par un, jamais un spread : un spread laisse passer en
    // silence une clé que le modèle ne porte plus. C'est ce qui a masqué
    // `role`, supprimé de Contact par la migration 20260725193000 au profit de
    // `jobFunctionId` — le seed échouait alors sur une base vierge, avant même
    // d'avoir créé le moindre compte de connexion.
    await prisma.contact.create({
      data: {
        clientId,
        isPrimary: true,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
      },
    });
  }
}

async function main() {
  const alice = await prisma.client.upsert({
    where: { email: "alice@sunrisecorp.com" },
    update: {},
    create: {
      email: "alice@sunrisecorp.com",
      companyName: "Sunrise Corporation",
      address: "123 Main St, Anytown, USA",
      country: "USA",
      city: "New York",
      zipCode: "10001",
    },
  });
  await ensurePrimaryContact(alice.id, {
    firstName: "Alice",
    lastName: "Smith",
    email: "alice@sunrisecorp.com",
  });
    const bob = await prisma.client.upsert({
    where: { email: "contact@oakenergy.com" },
    update: {},
    create: {
      email: "contact@oakenergy.com",
      companyName: "Oak Energy",
      address: "456 Oak Ave, Anothercity, USA",
      country: "USA",
      city: "New York",
      zipCode: "10001",
    },
  });
  await ensurePrimaryContact(bob.id, {
    firstName: "Bob",
    lastName: "Johnson",
    email: "bob@oakenergy.com",
  });
  const superadmin = await prisma.user.upsert({
    where: { email: "superadmin@example.com" },
    update: {},
    create: {
      email: "superadmin@example.com",
      name: "Super Admin",
      role: "SUPERADMIN",
      // Default dev password: "password123" — change it in real environments.
      password: await bcrypt.hash("password123", 10),
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
  const editor = await prisma.user.upsert({
    where: { email: "editor@example.com" },
    update: {},
    create: {
      email: "editor@example.com",
      name: "Editor",
      role: "EDITOR",
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

  console.log({ alice, bob, superadmin, admin, editor, viewer });
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