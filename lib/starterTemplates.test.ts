import { describe, expect, it } from 'vitest';
import { publishedCatalogStarterRows } from './starterTemplates';

describe('starter catalog head selection', () => {
  it('keeps only the published head for each starter key', () => {
    const rows = publishedCatalogStarterRows(
      [
        { catalog_key: 'project_template.audit', version: 1, payload: { id: 'audit-v1' } },
        { catalog_key: 'project_template.audit', version: 2, payload: { id: 'audit-v2' } },
        { catalog_key: 'project_template.tax', version: 1, payload: { id: 'tax-v1' } },
      ],
      [
        { catalog_key: 'project_template.audit', published_version: 2 },
        { catalog_key: 'project_template.tax', published_version: 1 },
      ],
    );

    expect(rows.map((row) => row.payload)).toEqual([
      { id: 'audit-v2' },
      { id: 'tax-v1' },
    ]);
  });
});
