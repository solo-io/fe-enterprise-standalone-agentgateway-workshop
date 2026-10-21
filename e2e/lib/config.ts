import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { configDiff, fixturePath, normalize, parseConfig } from './normalize.mjs';

const WORK_CONFIG = '/work/config.yaml';

/** The gateway config as the UI last saved it. */
export function readConfig(): any {
  return parseConfig(readFileSync(WORK_CONFIG, 'utf8'));
}

/** Asserts the current config equals the fixture (`base` is setup/config.yaml), as the harness checks at the end. */
export function expectMatchesFixture(name: string): void {
  const fixture = parseConfig(readFileSync(fixturePath('/repo', name), 'utf8'));
  expect(configDiff(readConfig(), fixture)).toEqual([]);
}

export { normalize };
