import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const isProduction = process.env.NODE_ENV === 'production'
  const masterEmail = process.env.MASTER_EMAIL ?? (isProduction ? '' : 'master@test.com')
  const masterPassword = process.env.MASTER_PASSWORD ?? (isProduction ? '' : 'master123')

  if (!masterEmail || !masterPassword) {
    throw new Error('MASTER_EMAIL and MASTER_PASSWORD are required when seeding production')
  }

  const masterPasswordHash = await bcrypt.hash(masterPassword, 10)

  const master = await prisma.user.upsert({
    where: { email: masterEmail },
    update: { role: 'MASTER', passwordHash: masterPasswordHash },
    create: {
      email: masterEmail,
      passwordHash: masterPasswordHash,
      role: 'MASTER',
    },
  })

  console.log(`Seeded master user: ${master.email} (id: ${master.id})`)

  const adminEmail = process.env.ADMIN_EMAIL ?? (isProduction ? '' : 'admin@test.com')
  const adminPassword = process.env.ADMIN_PASSWORD ?? (isProduction ? '' : 'admin123')
  if (adminEmail && adminPassword) {
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        role: 'ADMIN',
      },
    })
    console.log(`Seeded admin user: ${admin.email} (id: ${admin.id})`)
  }
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
