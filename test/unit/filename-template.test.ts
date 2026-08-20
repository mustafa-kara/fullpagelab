import { describe, expect, it } from 'vitest';
import { extensionForFormat, resolveFilename } from '../../src/background/export/filename-template';

describe('filename template', () => {
  it('resolves date, domain and counter tokens safely', () => {
    const filename = resolveFilename('{domain}_{yyyy-mm-dd}_{counter}', {
      domain: 'example.com',
      hostname: 'www.example.com',
      title: 'Docs: overview',
      url: 'https://example.com/docs',
      capturedAt: new Date('2026-08-20T11:22:33.000Z'),
      width: 800,
      height: 1_200,
      viewportWidth: 800,
      viewportHeight: 600,
      mode: 'fullPage',
      format: 'png',
      timezone: 'Europe/Istanbul',
      counter: () => 1,
    });

    expect(filename).toBe('example.com_2026-08-20_001');
  });

  it('maps supported export formats to file extensions', () => {
    expect(extensionForFormat('png')).toBe('png');
    expect(extensionForFormat('jpeg')).toBe('jpg');
    expect(extensionForFormat('webp')).toBe('webp');
    expect(extensionForFormat('pdf')).toBe('pdf');
  });
});
