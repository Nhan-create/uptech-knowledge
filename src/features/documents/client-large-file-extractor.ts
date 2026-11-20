const MAX_EXTRACTED_CHARS = 400_000;

const TEXT_LIKE_EXTENSIONS = new Set([
  "md",
  "txt",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "log",
  "sql",
  "ini",
  "env",
  "eml",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "java",
  "go",
  "rs",
  "css",
  "scss",
  "sh",
  "rtf",
]);

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTagsClean(xmlOrHtml: string): string {
  return decodeEntities(
    xmlOrHtml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(?:p|div|h[1-6]|li|tr|w:p|a:p|text:p|text:h|row)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function inflateRawBytesBrowser(compressed: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const stream = new Blob([
      new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength) as BlobPart,
    ])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

async function extractZipOfficeTextBrowser(file: File, ext: string): Promise<string> {
  if (file.size > 110 * 1024 * 1024) return "";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const wantEntry = (name: string): boolean => {
    if (ext === "docx") return name === "word/document.xml";
    if (ext === "pptx") return /^ppt\/slides\/slide\d+\.xml$/iu.test(name);
    if (ext === "xlsx") {
      return name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/iu.test(name);
    }
    return name === "content.xml";
  };

  const parts: string[] = [];
  let offset = 0;
  let totalChars = 0;

  while (offset + 30 <= bytes.length && totalChars < MAX_EXTRACTED_CHARS) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;

    const flags = view.getUint16(offset + 6, true);
    const compression = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd + extraLen > bytes.length) break;

    const entryName = decoder.decode(bytes.subarray(nameStart, nameEnd));
    const dataStart = nameEnd + extraLen;
    let effectiveCompSize = compSize;
    if ((flags & 0x08) !== 0 && compSize === 0) {
      let scan = dataStart;
      while (scan + 4 <= bytes.length) {
        if (
          bytes[scan] === 0x50 &&
          bytes[scan + 1] === 0x4b &&
          bytes[scan + 2] === 0x03 &&
          bytes[scan + 3] === 0x04
        ) {
          break;
        }
        scan++;
      }
      effectiveCompSize = scan < bytes.length ? Math.max(0, scan - dataStart - 16) : bytes.length - dataStart;
    }

    const dataEnd = Math.min(bytes.length, dataStart + effectiveCompSize);
    if (wantEntry(entryName) && (compression === 0 || compression === 8)) {
      const payload = bytes.subarray(dataStart, dataEnd);
      const raw = compression === 0 ? payload : await inflateRawBytesBrowser(payload);
      if (raw) {
        const xmlText = decoder.decode(raw);
        const extracted = stripTagsClean(xmlText);
        if (extracted) {
          const remaining = MAX_EXTRACTED_CHARS - totalChars;
          const sliced = extracted.slice(0, remaining);
          parts.push(sliced);
          totalChars += sliced.length;
        }
      }
    }
    offset = dataEnd;
    if (effectiveCompSize === 0 && compression === 8) break;
  }

  return parts.join("\n\n").trim();
}

export async function extractLargeFileTextInBrowser(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (TEXT_LIKE_EXTENSIONS.has(ext)) {
    const headBytes = Math.min(file.size, 2 * 1024 * 1024);
    const rawHead = await file.slice(0, headBytes).text();
    const cleaned =
      ext === "html" || ext === "htm" || ext === "xml"
        ? stripTagsClean(rawHead)
        : rawHead;
    return cleaned.slice(0, MAX_EXTRACTED_CHARS).trim();
  }

  if (
    ext === "docx" ||
    ext === "pptx" ||
    ext === "xlsx" ||
    ext === "odt" ||
    ext === "ods" ||
    ext === "odp"
  ) {
    const officeText = await extractZipOfficeTextBrowser(file, ext);
    if (officeText) return officeText;
  }

  // Fallback scan for PDF / legacy DOC/XLS/PPT or binary files > 3.5 MB
  const sampleBytes = Math.min(file.size, 6 * 1024 * 1024);
  const sliceBuf = new Uint8Array(await file.slice(0, sampleBytes).arrayBuffer());
  const latin = new TextDecoder("latin1", { fatal: false }).decode(sliceBuf);
  const runs: string[] = [];
  if (ext === "pdf") {
    for (const match of latin.matchAll(/\(([^()\\]{4,300})\)\s*Tj/g)) {
      const cleaned = (match[1] ?? "").replace(/[^\x20-\x7EÀ-ỹ\s]/g, " ").trim();
      if (cleaned.length >= 4) runs.push(cleaned);
      if (runs.join("\n").length >= MAX_EXTRACTED_CHARS) break;
    }
  }
  if (runs.length === 0) {
    for (const match of latin.matchAll(/[A-Za-z0-9À-ỹ][A-Za-z0-9À-ỹ ,.;:!?()\-_/]{12,240}/g)) {
      runs.push(match[0].trim());
      if (runs.join("\n").length >= 80_000) break;
    }
  }
  return runs.join("\n").slice(0, MAX_EXTRACTED_CHARS).trim();
}
