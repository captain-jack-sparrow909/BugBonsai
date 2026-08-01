import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInventory } from "./sandbox.js";

const UTF8_FLAG = 0x0800;
const DOS_DATE_1980_01_01 = 0x0021;

let crcTable: Uint32Array | undefined;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let current = value;
    for (let bit = 0; bit < 8; bit += 1)
      current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    crcTable[value] = current >>> 0;
  }
  return crcTable;
}

export function crc32(content: Buffer): number {
  let crc = 0xffffffff;
  const values = table();
  for (const byte of content)
    crc = (values[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(name: Buffer, content: Buffer, crc: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader(input: {
  name: Buffer;
  content: Buffer;
  crc: number;
  offset: number;
  mode: number;
}): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  header.writeUInt32LE(input.crc, 16);
  header.writeUInt32LE(input.content.length, 20);
  header.writeUInt32LE(input.content.length, 24);
  header.writeUInt16LE(input.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((input.mode & 0xffff) * 0x10000, 38);
  header.writeUInt32LE(input.offset, 42);
  return header;
}

export async function createDeterministicZip(
  root: string,
  destination: string,
): Promise<void> {
  const inventory = await createInventory(root, {
    include: [],
    exclude: [],
    keep: [],
  });
  if (inventory.files.length > 0xffff)
    throw new Error("ZIP32 supports at most 65,535 reproduction files.");
  await mkdir(path.dirname(destination), { recursive: true });
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const relative of [...inventory.files].sort()) {
    const absolute = path.join(root, relative);
    const info = await lstat(absolute);
    if (!info.isFile())
      throw new Error(`Cannot archive non-file entry: ${relative}`);
    const name = Buffer.from(relative.replaceAll("\\", "/"), "utf8");
    const content = await readFile(absolute);
    if (content.length > 0xffffffff)
      throw new Error(
        `ZIP32 cannot store files larger than 4 GiB: ${relative}`,
      );
    const crc = crc32(content);
    const archiveMode =
      content.subarray(0, 2).toString("utf8") === "#!" ? 0o100755 : 0o100644;
    const local = localHeader(name, content, crc);
    localParts.push(local, name, content);
    const central = centralHeader({
      name,
      content,
      crc,
      offset,
      mode: archiveMode,
    });
    centralParts.push(central, name);
    offset += local.length + name.length + content.length;
  }
  const centralSize = centralParts.reduce(
    (total, part) => total + part.length,
    0,
  );
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(inventory.files.length, 8);
  end.writeUInt16LE(inventory.files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  await writeFile(
    destination,
    Buffer.concat([...localParts, ...centralParts, end]),
    { flag: "wx" },
  );
}
