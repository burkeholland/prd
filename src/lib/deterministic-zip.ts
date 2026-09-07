import { prdBytesResponseBody } from './prd-export';

export const DETERMINISTIC_ZIP_TIME = 0;
export const DETERMINISTIC_ZIP_DATE = 0x2821;
export const DETERMINISTIC_ZIP_UNIX_MODE = 0o100644;

export interface DeterministicZipFile<Filename extends string = string> {
  readonly filename: Filename;
  readonly mimeType: string;
}

export type DeterministicZipResponseFactory = () =>
  | Response
  | Promise<Response>;
export type DeterministicZipSources<Filename extends string> = Partial<
  Record<Filename, DeterministicZipResponseFactory>
>;

interface DeterministicZipOptions<Filename extends string> {
  readonly label: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly files: readonly DeterministicZipFile<Filename>[];
  readonly sources: DeterministicZipSources<Filename>;
}

interface ArchiveEntry {
  readonly filename: string;
  readonly nameBytes: Uint8Array;
  readonly bytes: Uint8Array;
  readonly crc32: number;
}

const textEncoder = new TextEncoder();
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const VERSION_NEEDED = 20;
const UNIX_VERSION_MADE_BY = 0x0314;

const crcTable = new Uint32Array(256);
for (let value = 0; value < crcTable.length; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  crcTable[value] = crc >>> 0;
}

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(
    parts.reduce((length, part) => length + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

const localRecord = (entry: ArchiveEntry): Uint8Array => {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, VERSION_NEEDED, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, STORE_METHOD, true);
  view.setUint16(10, DETERMINISTIC_ZIP_TIME, true);
  view.setUint16(12, DETERMINISTIC_ZIP_DATE, true);
  view.setUint32(14, entry.crc32, true);
  view.setUint32(18, entry.bytes.byteLength, true);
  view.setUint32(22, entry.bytes.byteLength, true);
  view.setUint16(26, entry.nameBytes.byteLength, true);
  return concatenate([header, entry.nameBytes, entry.bytes]);
};

const centralRecord = (
  entry: ArchiveEntry,
  localOffset: number,
): Uint8Array => {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, UNIX_VERSION_MADE_BY, true);
  view.setUint16(6, VERSION_NEEDED, true);
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, STORE_METHOD, true);
  view.setUint16(12, DETERMINISTIC_ZIP_TIME, true);
  view.setUint16(14, DETERMINISTIC_ZIP_DATE, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, entry.bytes.byteLength, true);
  view.setUint32(24, entry.bytes.byteLength, true);
  view.setUint16(28, entry.nameBytes.byteLength, true);
  view.setUint32(38, DETERMINISTIC_ZIP_UNIX_MODE * 0x10000, true);
  view.setUint32(42, localOffset, true);
  return concatenate([header, entry.nameBytes]);
};

const createZip = (entries: readonly ArchiveEntry[]): Uint8Array => {
  const localRecords: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const local = localRecord(entry);
    localRecords.push(local);
    centralRecords.push(centralRecord(entry, localOffset));
    localOffset += local.byteLength;
  }

  const centralDirectory = concatenate(centralRecords);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, localOffset, true);
  return concatenate([...localRecords, centralDirectory, end]);
};

const sourceFilename = (response: Response): string | undefined => {
  const disposition = response.headers.get('content-disposition');
  return /^attachment; filename="([^"]+)"$/.exec(disposition ?? '')?.[1];
};

const isSafeRootFilename = (filename: string): boolean =>
  filename !== '' &&
  filename !== '.' &&
  filename !== '..' &&
  !/[/\\:\u0000-\u001f\u007f]/u.test(filename);

export async function createDeterministicZipResponse<Filename extends string>({
  label,
  filename: archiveFilename,
  mimeType: archiveMimeType,
  files,
  sources,
}: DeterministicZipOptions<Filename>): Promise<Response> {
  if (!isSafeRootFilename(archiveFilename)) {
    throw new Error(`${label}: archive filename "${archiveFilename}" is not safe`);
  }
  if (new Set(files.map(({ filename }) => filename)).size !== files.length) {
    throw new Error(`${label}: source filenames must be unique`);
  }

  const entries: ArchiveEntry[] = [];
  for (const required of files) {
    if (!isSafeRootFilename(required.filename)) {
      throw new Error(
        `${label}: source filename "${required.filename}" is not a safe root entry`,
      );
    }

    const createResponse = sources[required.filename];
    if (typeof createResponse !== 'function') {
      throw new Error(
        `${label}: source helper for "${required.filename}" is required`,
      );
    }

    const response = await createResponse();
    if (!(response instanceof Response)) {
      throw new Error(
        `${label}: source helper for "${required.filename}" must return a Response`,
      );
    }
    if (response.status !== 200) {
      throw new Error(
        `${label}: source "${required.filename}" returned status ${response.status}; expected 200`,
      );
    }
    const mimeType = response.headers.get('content-type');
    if (mimeType !== required.mimeType) {
      throw new Error(
        `${label}: source "${required.filename}" returned MIME "${mimeType ?? ''}"; expected "${required.mimeType}"`,
      );
    }
    const filename = sourceFilename(response);
    if (filename !== required.filename) {
      throw new Error(
        `${label}: source "${required.filename}" returned filename "${filename ?? ''}"; expected "${required.filename}"`,
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error(
        `${label}: source "${required.filename}" returned empty bytes`,
      );
    }
    entries.push({
      filename: required.filename,
      nameBytes: textEncoder.encode(required.filename),
      bytes,
      crc32: crc32(bytes),
    });
  }

  const bytes = createZip(entries);
  return new Response(prdBytesResponseBody(bytes), {
    status: 200,
    headers: {
      'Content-Type': archiveMimeType,
      'Content-Disposition': `attachment; filename="${archiveFilename}"`,
    },
  });
}
