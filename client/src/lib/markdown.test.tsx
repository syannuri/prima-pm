import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Markdown } from './markdown';

describe('Markdown', () => {
  it('renders nothing for blank input', () => {
    const { container } = render(<Markdown text="   " />);
    expect(container.textContent).toBe('');
  });

  it('renders bullet lists as <ul><li>', () => {
    const { container } = render(<Markdown text={'- one\n- two'} />);
    const items = container.querySelectorAll('ul li');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('one');
  });

  it('renders numbered lists as <ol><li>', () => {
    const { container } = render(<Markdown text={'1. a\n2. b'} />);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('renders bold and italic inline', () => {
    const { container } = render(<Markdown text={'a **bold** and *soft*'} />);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('soft');
  });

  it('renders headings', () => {
    const { container } = render(<Markdown text={'## Scope'} />);
    expect(container.textContent).toContain('Scope');
    // no raw marker leaks through
    expect(container.textContent).not.toContain('#');
  });

  it('keeps plain multi-line text as paragraphs with line breaks', () => {
    const { container } = render(<Markdown text={'line one\nline two'} />);
    expect(container.querySelectorAll('br')).toHaveLength(1);
    expect(container.textContent).toContain('line one');
  });

  it('renders a safe http link as an anchor with rel=noopener', () => {
    const { container } = render(<Markdown text={'see [docs](https://example.com)'} />);
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.getAttribute('rel')).toContain('noopener');
    expect(a?.textContent).toBe('docs');
  });

  it('never renders a javascript: link — falls back to raw text', () => {
    const { container } = render(<Markdown text={'[x](javascript:alert(1))'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('[x](javascript:alert(1))');
  });

  it('renders a pipe table as <table> with header + body cells', () => {
    const { container } = render(<Markdown text={'| Item | Owner |\n| --- | --- |\n| Kickoff | PM |\n| Design | Lead |'} />);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(container.querySelectorAll('thead th')).toHaveLength(2);
    expect(container.querySelector('thead th')?.textContent).toBe('Item');
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('td')[1].textContent).toBe('PM');
    // no raw pipe markers leak into the rendered text
    expect(container.textContent).not.toContain('---');
  });

  it('renders inline markup inside table cells and pads short rows', () => {
    const { container } = render(<Markdown text={'| A | B |\n| --- | --- |\n| **x** |'} />);
    expect(container.querySelector('tbody strong')?.textContent).toBe('x');
    // the missing 2nd cell is padded so the grid stays rectangular
    expect(container.querySelectorAll('tbody tr td')).toHaveLength(2);
  });

  it('leaves a lone pipe line (no separator) as plain text, not a table', () => {
    const { container } = render(<Markdown text={'a | b | c'} />);
    expect(container.querySelector('table')).toBeNull();
    expect(container.textContent).toContain('a | b | c');
  });
});
