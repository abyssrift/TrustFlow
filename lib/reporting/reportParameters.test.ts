import { describe, expect, it } from 'vitest';
import { redactSensitiveReportParameters } from './reportParameters';

describe('redactSensitiveReportParameters', () => {
  it('removes salary inputs from persisted top-level and nested report parameters', () => {
    const input = {
      from: 'desktop',
      salaries: { userA: 100 },
      modules: [
        { type: 'personnel_comparison', parameters: { user_ids: ['userA'], salaries: { userA: 200 } } },
      ],
    };

    expect(redactSensitiveReportParameters(input)).toEqual({
      from: 'desktop',
      modules: [{ type: 'personnel_comparison', parameters: { user_ids: ['userA'] } }],
    });
    expect(input.salaries).toEqual({ userA: 100 });
  });

  it('redacts salary keys case-insensitively at arbitrary object/array depth', () => {
    expect(redactSensitiveReportParameters({ reports: [{ Parameters: { SALARIES: [1], keep: true } }] }))
      .toEqual({ reports: [{ Parameters: { keep: true } }] });
  });

  it('returns safe values without changing scalar/null inputs', () => {
    expect(redactSensitiveReportParameters(null)).toBeNull();
    expect(redactSensitiveReportParameters('safe')).toBe('safe');
  });
});
