/** Classifies relative paths by directory names and file extensions. */
export const FILE_KINDS = ['dependencies', 'build', 'version-control', 'logs', 'media', 'archives', 'code', 'documents', 'other'] as const;
export type FileKind = typeof FILE_KINDS[number];

const versionControl = new Set(['.git', '.hg', '.svn']);
const dependencies = new Set(['node_modules', 'vendor', '.venv', 'venv', '.pnpm', '.yarn', 'pods']);
const build = new Set(['dist', 'build', '.next', '.nuxt', '.output', 'target', 'out', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.turbo', '.parcel-cache', 'coverage']);
const logs = new Set(['log', 'logs']);
const extensions: readonly [FileKind, ReadonlySet<string>][] = [
  ['logs', new Set(['log', 'trace', 'etl', 'jsonl', 'ndjson'])],
  ['media', new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'ico', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'mid', 'midi', 'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpeg', 'mpg', '3gp'])],
  ['archives', new Set(['zip', 'tar', 'gz', 'zst', 'zstd', '7z', 'bz2', 'xz', 'rar', 'br', 'tgz', 'whl', 'jar', 'war', 'apk', 'ipa', 'dmg', 'iso'])],
  ['code', new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'py', 'pyi', 'ipynb', 'lua', 'rb', 'go', 'rs', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'java', 'kt', 'kts', 'swift', 'm', 'mm', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql', 'r', 'dart', 'ex', 'exs', 'erl', 'hs', 'pl', 'php', 'toml', 'yaml', 'yml', 'json', 'xml', 'ini', 'cfg', 'conf', 'properties', 'env', 'lock'])],
  ['documents', new Set(['pdf', 'md', 'mdx', 'rst', 'txt', 'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'csv', 'tsv', 'numbers', 'ppt', 'pptx', 'odp', 'key', 'pages', 'tex', 'bib', 'epub'])],
];
const codeNames = new Set(['dockerfile', 'makefile', 'gnumakefile', 'cmakelists.txt', 'requirements.txt', 'gemfile', 'rakefile', 'go.mod', 'go.sum', '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.env']);
const documentNames = new Set(['readme', 'license', 'licence', 'notice', 'changelog', 'authors', 'copying']);

/** Recognized relative folders take precedence over extensions. The leaf name
 * is never treated as a directory, and both platform separators are accepted. */
export function classifyStorageFile(relativePath: string): FileKind {
  const parts = relativePath.toLowerCase().split(/[/\\]/).filter(Boolean);
  const name = parts.pop() ?? '';
  if (parts.some(part => versionControl.has(part))) return 'version-control';
  if (parts.some(part => dependencies.has(part))) return 'dependencies';
  if (parts.some(part => build.has(part))) return 'build';
  if (parts.some(part => logs.has(part))) return 'logs';
  if (/\.(?:log|trace|jsonl|ndjson)\.(?:gz|zst|zstd|xz|bz2)$/.test(name)) return 'logs';
  if (codeNames.has(name) || name.startsWith('.env.')) return 'code';
  if (documentNames.has(name)) return 'documents';
  const dot = name.lastIndexOf('.'); const extension = dot < 0 ? '' : name.slice(dot + 1);
  for (const [kind, names] of extensions) if (names.has(extension)) return kind;
  return 'other';
}

const priority: Record<FileKind, number> = {
  'version-control': 0, dependencies: 1, build: 2, logs: 3, media: 4, archives: 5, code: 6, documents: 7, other: 8,
};
/** Hard-link aliases may have different names. Attribute their measured bytes
 * once, using stable precedence rather than directory enumeration order. */
export function preferredFileKind(first: FileKind, second: FileKind): FileKind {
  return priority[first] <= priority[second] ? first : second;
}
