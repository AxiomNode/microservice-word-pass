/** @module client - Singleton Prisma database client for the wordpass microservice. */
import { PrismaClient } from "@prisma/client";

/** Shared Prisma client instance used across the application. */
export const prisma = new PrismaClient();
