/** Public update data never grants a browser control over a URL or disk path. */
export interface UpdateCandidate {
  id: string;
  version: string;
  requiredDshVersion: string;
  publishedAt: string;
  releaseUrl: string;
  notes: string;
  assetBytes: number;
}
export interface UpdateInstallation {
  requestId: string;
  version: string;
  status: 'installing' | 'installed' | 'restart-required' | 'failed' | 'interrupted' | 'unknown';
  code?: string;
}
export interface UpdateOverview {
  currentVersion: string;
  installedVersion: string;
  hostVersion: string;
  availability: 'unknown' | 'current' | 'available' | 'incompatible' | 'error';
  checkedAt?: number;
  nextCheckAt?: number;
  candidate?: UpdateCandidate;
  code?: string;
  canInstall: boolean;
  installation?: UpdateInstallation;
}
/** Release asset published with every updater-capable GitHub release. */
export interface ReleaseUpdateMetadata {
  schema: 1;
  packageName: '@qwqbig/dsh-archive-delete';
  version: string;
  requiredDshVersion: string;
  platforms: Array<'darwin' | 'win32'>;
  asset: { name: string; bytes: number; sha256: string };
}
