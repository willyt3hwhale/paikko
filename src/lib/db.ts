/**
 * Prisma client singleton. Avoids exhausting connections under Next's dev HMR by
 * caching the client on globalThis.
 *
 * The client is wrapped in the paikko query-capture extension (see
 * {@link withQueryCapture}) so every query issued inside an active `withCapture`
 * request lands in that request's trace context. Queries outside a request are
 * silently ignored, so the extension is always safe to apply.
 */
import { PrismaClient } from "@prisma/client";
import {
  withQueryCapture,
  type CapturingPrismaClient,
} from "@/paikko/server/prismaMiddleware";

const globalForPrisma = globalThis as unknown as {
  prisma: CapturingPrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? withQueryCapture(new PrismaClient());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
