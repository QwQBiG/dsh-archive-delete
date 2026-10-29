export interface InstalledUpdateTarget {
  version: string;
  /** The currently declared profile dependency, never sent to the browser. */
  source: string;
}
export interface HostUpdateResult {
  status: 'installed' | 'restart-required' | 'failed' | 'unknown';
  code?: string;
}
export interface UpdateHost {
  /** Canonical current-profile identity; retained only on the server. */
  profileId: string;
  hostVersion: string;
  /** This instance may still be executing older loaded code after a replacement. */
  loadedVersion: string;
  canInstall: boolean;
  installed(): Promise<InstalledUpdateTarget>;
  /** Pass only a server-verified persistent .tgz to the current profile's native manager. */
  install(packagePath: string, version: string, requestId: string): Promise<HostUpdateResult>;
}
