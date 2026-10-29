import { createRequire } from 'node:module';

/** Source and installed bundles both resolve their own package's metadata. */
export const PLUGIN_VERSION: string = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
