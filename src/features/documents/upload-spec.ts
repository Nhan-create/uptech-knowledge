export const MIN_WORKSPACE_UPLOAD_MB = 100;
export const MAX_UPLOAD_BYTES = MIN_WORKSPACE_UPLOAD_MB * 1024 * 1024;
export const CLIENT_MULTIPART_THRESHOLD_BYTES = Math.floor(3.5 * 1024 * 1024);

export const SUPPORTED_UPLOAD_EXTENSIONS = [
  // Office & rich documents
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "pptx",
  "ppt",
  "rtf",
  "odt",
  "ods",
  "odp",
  // Text, markdown & structured data
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
  // Code & config
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
  // Images
  "png",
  "jpg",
  "jpeg",
  "webp",
] as const;

export const SUPPORTED_UPLOAD_EXTENSION_SET: ReadonlySet<string> = new Set(
  SUPPORTED_UPLOAD_EXTENSIONS,
);

export const SUPPORTED_UPLOAD_ACCEPT = SUPPORTED_UPLOAD_EXTENSIONS.map(
  (ext) => `.${ext}`,
).join(",");
