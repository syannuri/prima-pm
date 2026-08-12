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
});
