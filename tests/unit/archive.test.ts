import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { crc32, createDeterministicZip } from "../../src/archive.js";
import { runCommand } from "../../src/process.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("deterministic ZIP export", () => {
  it("uses the standard CRC-32 test vector", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("produces identical bytes with sorted entries and fixed timestamps", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "bugbonsai-zip-"));
    created.push(temporary);
    const root = path.join(temporary, "root");
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "z.txt"), "last\n");
    await writeFile(path.join(root, "nested", "a.txt"), "first\n");
    const first = path.join(temporary, "first.zip");
    const second = path.join(temporary, "second.zip");
    await createDeterministicZip(root, first);
    await createDeterministicZip(root, second);
    const firstBytes = await readFile(first);
    const secondBytes = await readFile(second);
    expect(firstBytes.equals(secondBytes)).toBe(true);
    expect(firstBytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(firstBytes.readUInt32LE(firstBytes.length - 22)).toBe(0x06054b50);
    if (process.platform !== "win32") {
      const validation = await runCommand(["unzip", "-t", first], {
        cwd: temporary,
        timeoutMs: 5_000,
      });
      expect(validation.exitCode).toBe(0);
    }
  });
});
