const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new Pool({
      connectionString: process.env.DATABASE_URL,
    }),
  ),
});

async function main() {
  const email = "admin@admin.com";
  const password = "admin1234";

  const existingAdmin = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingAdmin) {
    console.log(`Default admin already exists: ${email}`);
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      name: "Administrador",
      email,
      password: hashedPassword,
      role: "ADMIN",
      emailVerified: new Date(),
    },
  });

  console.log(`Default admin created: ${email}`);
}

main()
  .catch((error) => {
    console.error("Failed to seed default admin:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
