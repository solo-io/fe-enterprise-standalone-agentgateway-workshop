import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { normalize, parseConfig } from './normalize.mjs';

const WORK_CONFIG = '/work/config.yaml';

/** The gateway config as the UI last saved it. */
export function readConfig(): any {
  return parseConfig(readFileSync(WORK_CONFIG, 'utf8'));
}

/** Asserts the current config equals e2e/fixtures/<name>.yaml, ignoring UI-generated metadata. */
export function expectMatchesFixture(name: string): void {
  const fixture = parseConfig(readFileSync(`/repo/e2e/fixtures/${name}.yaml`, 'utf8'));
  expect(normalize(readConfig())).toEqual(normalize(fixture));
}

export { normalize };
