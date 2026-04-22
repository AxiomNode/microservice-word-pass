import { describe, expect, it, vi } from "vitest";

const { prismaClientMock } = vi.hoisted(() => ({
  prismaClientMock: vi.fn(),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: prismaClientMock,
}));

describe("db client", () => {
  it("creates a shared PrismaClient singleton", async () => {
    const instance = { label: "prisma-singleton" };
    prismaClientMock.mockImplementation(() => instance);

    const { prisma } = await import("../app/db/client.js");

    expect(prismaClientMock).toHaveBeenCalledTimes(1);
    expect(prisma).toBe(instance);
  });
});