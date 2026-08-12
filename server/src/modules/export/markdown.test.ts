import { describe, it, expect } from 'vitest';
import { mdToPlain } from './markdown.js';

describe('mdToPlain', () => {
  it('returns empty string for nullish input', () => {
    expect(mdToPlain(null)).toBe('');
    expect(mdToPlain(undefined)).toBe('');
    expect(mdToPlain('')).toBe('');
  });

  it('passes plain text through unchanged', () => {
    expect(mdToPlain('Just a normal sentence.')).toBe('Just a normal sentence.');
  });

  it('turns bullets into • and keeps numbered prefixes', () => {
    expect(mdToPlain('- one\n- two')).toBe('• one\n• two');
    expect(mdToPlain('* a\n* b')).toBe('• a\n• b');
    expect(mdToPlain('1. first\n2. second')).toBe('1. first\n2. second');
  });

  it('strips heading and emphasis markers, keeping the words', () => {
    expect(mdToPlain('## Scope')).toBe('Scope');
    expect(mdToPlain('deliver **fast** and *clean*')).toBe('deliver fast and clean');
    expect(mdToPlain('an _italic_ word')).toBe('an italic word');
  });

  it('preserves leading indentation on bullets', () => {
    expect(mdToPlain('  - nested')).toBe('  • nested');
  });

  it('handles a mixed multi-line block', () => {
    const md = '# Goals\n- ship **v1**\n- reduce cost\n\nPlain closing line.';
    expect(mdToPlain(md)).toBe('Goals\n• ship v1\n• reduce cost\n\nPlain closing line.');
  });
});
