import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormattedText } from '@/components/FormattedText';

describe('FormattedText', () => {
  it('renders single-asterisk markdown as <em> without literal asterisks', () => {
    const { container } = render(
      <FormattedText text="*Trichomonas vaginalis* trophozoites" />,
    );

    const em = container.querySelector('em');
    expect(em).toBeInTheDocument();
    expect(em).toHaveTextContent('Trichomonas vaginalis');
    expect(container).toHaveTextContent('Trichomonas vaginalis trophozoites');
    expect(container.textContent).not.toContain('*');
  });

  it('renders multiple italicized spans, bold, bold-italic, and inline code', () => {
    const { container } = render(
      <FormattedText text="**Note:** *S. aureus* and *E. coli* (***beta-hemolytic***) via `Gram stain`" />,
    );

    const strongs = container.querySelectorAll('strong');
    const ems = container.querySelectorAll('em');
    const code = container.querySelector('code');

    expect(strongs[0]).toHaveTextContent('Note:');
    expect(ems[0]).toHaveTextContent('S. aureus');
    expect(ems[1]).toHaveTextContent('E. coli');
    expect(ems[2]).toHaveTextContent('beta-hemolytic');
    expect(code).toHaveTextContent('Gram stain');
  });

  it('preserves spaced multiplication asterisks and escaped asterisks as literal text', () => {
    render(
      <FormattedText text="Count = 2 * 3 * 4 and literal \*star\*" />,
    );

    expect(
      screen.getByText('Count = 2 * 3 * 4 and literal *star*'),
    ).toBeInTheDocument();
  });
});
