import { mergeDomain } from '../../src/sync-editor/merge';

describe('mergeDomain', () => {
  it('propagates single-editor change', () => {
    const result = mergeDomain({
      type: 'settings',
      baseline: { 'editor.fontSize': 14 },
      current: {
        vscode: { 'editor.fontSize': 16 },
        cursor: { 'editor.fontSize': 14 },
        trae: { 'editor.fontSize': 14 },
      },
    });

    expect(result.conflicts).toEqual([]);
    expect(result.resolved['editor.fontSize']).toBe(16);
  });

  it('propagates same multi-editor change', () => {
    const result = mergeDomain({
      type: 'settings',
      baseline: { 'files.autoSave': 'off' },
      current: {
        vscode: { 'files.autoSave': 'afterDelay' },
        cursor: { 'files.autoSave': 'afterDelay' },
        trae: { 'files.autoSave': 'off' },
      },
    });

    expect(result.conflicts).toEqual([]);
    expect(result.resolved['files.autoSave']).toBe('afterDelay');
  });

  it('creates conflict when multi-editor changed differently', () => {
    const result = mergeDomain({
      type: 'settings',
      baseline: { 'workbench.colorTheme': 'Default Light+' },
      current: {
        vscode: { 'workbench.colorTheme': 'Monokai' },
        cursor: { 'workbench.colorTheme': 'Solarized Dark' },
        trae: { 'workbench.colorTheme': 'Default Light+' },
      },
    });

    expect(result.resolved['workbench.colorTheme']).toBeUndefined();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      type: 'settings',
      id: 'workbench.colorTheme',
      status: 'pending',
    });
  });
});
