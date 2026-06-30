import { PrismaClient } from '@prisma/client'

// Prisma 7: in production we pass the adapter via constructor.
// For now we rely on the generated client which reads DATABASE_URL
// from the prisma.config.ts adapter setup during migrations,
// but at runtime just uses the standard PrismaClient with env.

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
