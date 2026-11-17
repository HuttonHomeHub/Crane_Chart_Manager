import { describe, expect, it } from 'vitest';
import {
  groupCatalogue,
  isPdf,
  minCapacity,
  naturalCompare,
  paletteMatches,
  parseCapacity,
  parseFilename,
  searchText,
} from '../src/lib/catalogue.ts';
import { formatBytes, formatWhen, plural } from '../src/lib/format.ts';
import { crane } from './factories.ts';

describe('catalogue rules from 1.x', () => {
  it('sorts naturally, ignoring case', () => {
    const models = ['LTM11200-9.1', 'ltm1750-9.1', 'LTM1300-6.2'];
    expect(models.sort(naturalCompare)).toEqual(['LTM1300-6.2', 'ltm1750-9.1', 'LTM11200-9.1']);
  });

  it('groups by make, then type, then model, with fallbacks for blanks', () => {
    const groups = groupCatalogue([
      crane({ make: 'Tadano', model: 'AC2' }),
      crane({ make: 'Liebherr', type: 'Crawler', model: 'LR1300' }),
      crane({ make: 'Liebherr', type: 'Mobile', model: 'LTM1750' }),
      crane({ make: 'Liebherr', type: 'Mobile', model: 'LTM1300' }),
      crane({ make: '', type: '', model: '' }),
    ]);
    expect(groups.map((g) => g.make)).toEqual(['Liebherr', 'Tadano', 'Unknown']);
    const lieb = groups[0];
    expect(lieb?.types.map((t) => t.type)).toEqual(['Crawler', 'Mobile']);
    expect(lieb?.types[1]?.cranes.map((c) => c.model)).toEqual(['LTM1300', 'LTM1750']);
    expect(groups[2]?.types[0]?.type).toBe('Other');
  });

  it('searches details and file labels', () => {
    const c = crane({ make: 'Grove', model: 'GMK5150' }, ['Outrigger chart']);
    expect(searchText(c)).toContain('grove');
    expect(searchText(c)).toContain('outrigger chart');
  });

  it('reads capacities and minimum-capacity queries', () => {
    expect(parseCapacity('1 200 t')).toBe(1200);
    expect(parseCapacity('1,200.5t')).toBe(1200.5);
    expect(parseCapacity('heavy')).toBeNaN();
    expect(minCapacity('>=150')).toBe(150);
    expect(minCapacity('> 150')).toBe(150);
    expect(minCapacity('≥7.5')).toBe(7.5);
    expect(minCapacity('150t+')).toBe(150);
    expect(minCapacity('150+')).toBe(150);
    expect(minCapacity('150t')).toBeNull();
  });

  it('matches the palette by capacity (smallest first) or by every word', () => {
    const cranes = [
      crane({ make: 'A', model: 'Big', capacity: '900t' }),
      crane({ make: 'B', model: 'Small', capacity: '50t' }),
      crane({ make: 'C', model: 'Mid', capacity: '300t' }),
    ];
    expect(paletteMatches(cranes, '>=100').map((c) => c.model)).toEqual(['Mid', 'Big']);
    expect(paletteMatches(cranes, 'zzz big').map((c) => c.model)).toEqual([]);
    expect(paletteMatches(cranes, 'a big').map((c) => c.model)).toEqual(['Big']);
    expect(paletteMatches(cranes, '  ')).toHaveLength(3);
    const many = Array.from({ length: 70 }, (_, i) => crane({ model: `M${i}` }));
    expect(paletteMatches(many, '')).toHaveLength(60);
  });

  it('reads details from a file name', () => {
    expect(parseFilename('Liebherr LTM1100 (Load Chart).pdf')).toEqual({
      make: 'Liebherr',
      model: 'LTM1100',
      label: 'Load Chart',
    });
    expect(parseFilename('Grove  GMK 5150.PDF')).toEqual({
      make: 'Grove',
      model: 'GMK 5150',
      label: '',
    });
    expect(parseFilename('(only a label).pdf')).toEqual({
      make: '',
      model: '',
      label: 'only a label',
    });
  });

  it('recognises PDFs by name or type', () => {
    expect(isPdf(new File([''], 'a.PDF'))).toBe(true);
    expect(isPdf(new File([''], 'a', { type: 'application/pdf' }))).toBe(true);
    expect(isPdf(new File([''], 'a.txt'))).toBe(false);
  });

  it('formats sizes, dates and counts', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
    expect(formatBytes(3 * 1024 ** 4)).toBe('3072 GB');
    expect(formatWhen('2026-11-16T03:00:00Z')).toMatch(/16 Nov 2026/);
    expect(plural(1, 'crane')).toBe('1 crane');
    expect(plural(2, 'crane')).toBe('2 cranes');
  });
});
