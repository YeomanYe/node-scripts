import { ConflictEntry, EditorName, MergeDomainInput, MergeDomainResult } from './types';

const EDITORS: EditorName[] = ['vscode', 'cursor', 'trae'];

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortValue);
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stableSortValue(v)]);

    return Object.fromEntries(entries);
  }

  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableSortValue(a)) === JSON.stringify(stableSortValue(b));
}

function uniqueValues(values: unknown[]): unknown[] {
  const uniques: unknown[] = [];
  for (const value of values) {
    if (!uniques.some((x) => deepEqual(x, value))) {
      uniques.push(value);
    }
  }
  return uniques;
}

export function mergeDomain(input: MergeDomainInput): MergeDomainResult {
  const keys = new Set<string>([
    ...Object.keys(input.baseline),
    ...Object.keys(input.current.vscode),
    ...Object.keys(input.current.cursor),
    ...Object.keys(input.current.trae),
  ]);

  const resolved: Record<string, unknown> = {};
  const conflicts: ConflictEntry[] = [];

  for (const id of keys) {
    const baselineValue = input.baseline[id];
    const currentValues: Record<EditorName, unknown> = {
      vscode: input.current.vscode[id],
      cursor: input.current.cursor[id],
      trae: input.current.trae[id],
    };

    const changedEditors = EDITORS.filter((editor) => !deepEqual(currentValues[editor], baselineValue));

    if (changedEditors.length === 0) {
      resolved[id] = baselineValue;
      continue;
    }

    if (changedEditors.length === 1) {
      resolved[id] = currentValues[changedEditors[0]];
      continue;
    }

    const changedValues = changedEditors.map((editor) => currentValues[editor]);
    const uniqueChangedValues = uniqueValues(changedValues);

    if (uniqueChangedValues.length === 1) {
      resolved[id] = uniqueChangedValues[0];
      continue;
    }

    conflicts.push({
      type: input.type,
      id,
      candidates: currentValues,
      status: 'pending',
    });
  }

  return { resolved, conflicts };
}
