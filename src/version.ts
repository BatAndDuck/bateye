import packageJson from '../package.json';

export const BATEYE_VERSION: string = (packageJson as { version: string }).version;
