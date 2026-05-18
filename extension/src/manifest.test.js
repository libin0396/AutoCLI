import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const extensionRoot = resolve(import.meta.dirname, '..');

function readJSON(relativePath) {
  return JSON.parse(readFileSync(resolve(extensionRoot, relativePath), 'utf8'));
}

describe('extension manifest branding', () => {
  it('uses amiibot branding and keeps visible version fields in sync', () => {
    const manifest = readJSON('manifest.json');
    const packageJSON = readJSON('package.json');
    const packageLock = readJSON('package-lock.json');

    expect(manifest.name).toBe('amiibot');
    expect(manifest.short_name).toBe('amiibot');
    expect(packageJSON.name).toBe('amiibot-extension');
    expect(packageLock.name).toBe('amiibot-extension');
    expect(packageLock.packages[''].name).toBe('amiibot-extension');
    expect(packageJSON.version).toBe(manifest.version);
    expect(packageLock.version).toBe(manifest.version);
    expect(packageLock.packages[''].version).toBe(manifest.version);
    expect(manifest.description).toContain(`v${manifest.version}`);
    expect(manifest.action?.default_title).toBe(`amiibot v${manifest.version}`);
    expect(`${manifest.name} ${manifest.short_name ?? ''} ${manifest.description} ${manifest.action?.default_title ?? ''} ${manifest.homepage_url ?? ''}`)
      .not.toMatch(/autocli/i);
  });
});
