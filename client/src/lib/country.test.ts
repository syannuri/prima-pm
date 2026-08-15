import { describe, it, expect } from 'vitest';
import { countryFlag } from './country';

describe('countryFlag', () => {
  it('maps a valid ISO code to the regional-indicator flag', () => {
    expect(countryFlag('ID')).toBe('🇮🇩');
    expect(countryFlag('us')).toBe('🇺🇸'); // case-insensitive
    expect(countryFlag('SG')).toBe('🇸🇬');
  });
  it('falls back to a neutral flag for invalid input', () => {
    expect(countryFlag('XXX')).toBe('🏳️');
    expect(countryFlag('1')).toBe('🏳️');
    expect(countryFlag('')).toBe('🏳️');
  });
});
