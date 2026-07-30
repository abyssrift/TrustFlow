import { describe, expect, it } from 'vitest';
import { rangeKeysBetween } from './calendarRange';

// Mirrors the overlay's 42-cell grid shape, abbreviated.
const grid = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5'];

describe('rangeKeysBetween', () => {
  it('spans anchor to end inclusive', () => {
    expect(rangeKeysBetween(grid, 'd1', 'd4')).toEqual(['d1', 'd2', 'd3', 'd4']);
  });

  it('handles hovering backwards from the anchor', () => {
    expect(rangeKeysBetween(grid, 'd4', 'd1')).toEqual(['d1', 'd2', 'd3', 'd4']);
  });

  it('returns the single day when anchor and end match', () => {
    expect(rangeKeysBetween(grid, 'd2', 'd2')).toEqual(['d2']);
  });

  // The crash path: a stale anchor from a month that is no longer displayed
  // must yield nothing, never an undefined-padded slice.
  it('returns empty when a key is not in the grid', () => {
    expect(rangeKeysBetween(grid, 'stale', 'd3')).toEqual([]);
    expect(rangeKeysBetween(grid, 'd3', 'stale')).toEqual([]);
    expect(rangeKeysBetween(grid, 'stale', 'stale')).toEqual([]);
  });
});
