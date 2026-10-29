import { PrismaClient } from '@prisma/client';

const prismaGlobal = globalThis as typeof globalThis & {
  cybernexusPrisma?: PrismaClient;
};

export const prisma = prismaGlobal.cybernexusPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  prismaGlobal.cybernexusPrisma = prisma;
}
