import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { ErrorToast } from './ErrorToast';

describe('ErrorToast', () => {
  it('adds a tooltip to the dismiss button', () => {
    render(<ErrorToast message="Something failed" duration={0} />);

    expect(screen.getByTitle('Dismiss notification')).toBeTruthy();
  });
});
