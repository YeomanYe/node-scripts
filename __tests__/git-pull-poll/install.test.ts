import {
  detectPackageManager,
  shouldInstallForChanges,
  packageManagerCandidates,
  installArgs
} from '../../src/git-pull-poll/index';

describe('detectPackageManager', () => {
  it('returns null when there is no package.json (not a Node project)', () => {
    expect(detectPackageManager(['Cargo.toml', 'src'])).toBeNull();
    expect(detectPackageManager([])).toBeNull();
  });

  it('picks pnpm / npm / yarn by lockfile', () => {
    expect(detectPackageManager(['package.json', 'pnpm-lock.yaml'])).toBe('pnpm');
    expect(detectPackageManager(['package.json', 'package-lock.json'])).toBe('npm');
    expect(detectPackageManager(['package.json', 'yarn.lock'])).toBe('yarn');
  });

  it('defaults to pnpm when package.json exists but no lockfile (machine convention)', () => {
    expect(detectPackageManager(['package.json'])).toBe('pnpm');
  });

  it('prefers pnpm when multiple lockfiles are present', () => {
    expect(
      detectPackageManager(['package.json', 'pnpm-lock.yaml', 'package-lock.json'])
    ).toBe('pnpm');
  });
});

describe('shouldInstallForChanges', () => {
  it('triggers when package.json or a lockfile changed', () => {
    expect(shouldInstallForChanges(['package.json'])).toBe(true);
    expect(shouldInstallForChanges(['pnpm-lock.yaml'])).toBe(true);
    expect(shouldInstallForChanges(['src/a.ts', 'package-lock.json'])).toBe(true);
    expect(shouldInstallForChanges(['yarn.lock'])).toBe(true);
  });

  it('triggers for a nested package.json / lockfile (monorepo)', () => {
    expect(shouldInstallForChanges(['packages/web/package.json'])).toBe(true);
    expect(shouldInstallForChanges(['apps/api/pnpm-lock.yaml'])).toBe(true);
  });

  it('does not trigger for unrelated changes', () => {
    expect(shouldInstallForChanges(['src/a.ts', 'README.md'])).toBe(false);
    expect(shouldInstallForChanges([])).toBe(false);
  });
});

describe('installArgs', () => {
  it('maps each package manager to its install command', () => {
    expect(installArgs('pnpm')).toEqual({ bin: 'pnpm', args: ['install'] });
    expect(installArgs('npm')).toEqual({ bin: 'npm', args: ['install'] });
    expect(installArgs('yarn')).toEqual({ bin: 'yarn', args: ['install'] });
  });
});

describe('packageManagerCandidates', () => {
  it('lists the bare name first then common absolute fallbacks', () => {
    const c = packageManagerCandidates('pnpm', '/Users/x');
    expect(c[0]).toBe('pnpm');
    expect(c.some((p) => p.includes('/Users/x') || p.startsWith('/'))).toBe(true);
    expect(c.every((p) => typeof p === 'string')).toBe(true);
  });
});
