import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('joins headers + rows with CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 2], [3, 4]])).toBe('a,b\r\n1,2\r\n3,4');
  });
  it('quotes fields containing comma, quote or newline', () => {
    expect(toCsv(['name'], [['Acme, Inc']])).toBe('name\r\n"Acme, Inc"');
    expect(toCsv(['q'], [['say "hi"']])).toBe('q\r\n"say ""hi"""');
    expect(toCsv(['m'], [['line1\nline2']])).toBe('m\r\n"line1\nline2"');
  });
  it('renders null/undefined as empty', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,');
  });
});
