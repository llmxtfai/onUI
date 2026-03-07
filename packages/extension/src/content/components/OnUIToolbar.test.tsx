import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import type { Annotation } from '@/types';
import { OnUIToolbar } from './OnUIToolbar';
import { copyToClipboard } from '../utils/clipboard';

vi.mock('../utils/clipboard', () => ({
  copyToClipboard: vi.fn(async () => true),
}));

vi.mock('../utils/output-generation', () => ({
  generateOutput: vi.fn(() => 'copied annotation output'),
}));

function createAnnotation(id: string): Annotation {
  return {
    id,
    selector: `#annotation-${id}`,
    elementPath: `div > #annotation-${id}`,
    tagName: 'div',
    comment: `Annotation ${id}`,
    boundingBox: {
      top: 0,
      left: 0,
      width: 100,
      height: 20,
      isFixed: false,
    },
    createdAt: 1,
    updatedAt: 1,
    pageUrl: 'https://example.com',
    pageTitle: 'Example',
    attributes: {},
  };
}

function renderToolbar({
  isAnnotateMode = false,
  isDrawMode = false,
  drawShape = 'rectangle' as const,
  multiSelectCount = 0,
  onToggleAnnotateMode = vi.fn(),
  onToggleDrawMode = vi.fn(),
  onSelectDrawShape = vi.fn(),
  onEscape = vi.fn(),
  clearOnCopy = false,
  onClearOnCopyChange = vi.fn(),
  onClearAnnotations = vi.fn(),
  onComplete = vi.fn(),
  annotations = [],
}: {
  isAnnotateMode?: boolean;
  isDrawMode?: boolean;
  drawShape?: 'rectangle' | 'ellipse';
  multiSelectCount?: number;
  onToggleAnnotateMode?: () => void | Promise<boolean>;
  onToggleDrawMode?: () => void;
  onSelectDrawShape?: (shape: 'rectangle' | 'ellipse') => void;
  onEscape?: () => void;
  clearOnCopy?: boolean;
  onClearOnCopyChange?: (enabled: boolean) => void;
  onClearAnnotations?: () => void | Promise<void>;
  onComplete?: () => void | Promise<void>;
  annotations?: Annotation[];
} = {}) {
  render(
    <OnUIToolbar
      isAnnotateMode={isAnnotateMode}
      isDrawMode={isDrawMode}
      drawShape={drawShape}
      multiSelectCount={multiSelectCount}
      onToggleAnnotateMode={onToggleAnnotateMode}
      onToggleDrawMode={onToggleDrawMode}
      onSelectDrawShape={onSelectDrawShape}
      onEscape={onEscape}
      annotations={annotations}
      outputLevel="standard"
      onOutputLevelChange={vi.fn()}
      clearOnCopy={clearOnCopy}
      onClearOnCopyChange={onClearOnCopyChange}
      onClearAnnotations={onClearAnnotations}
      onComplete={onComplete}
    />
  );
}

describe('OnUIToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(copyToClipboard).mockResolvedValue(true);
  });

  it('renders icon-only main controls when expanded', async () => {
    renderToolbar({ annotations: [createAnnotation('1')] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));

    const annotateButton = screen.getByRole('button', { name: 'Toggle annotate mode' });
    const drawButton = screen.getByRole('button', { name: 'Toggle draw mode' });
    const copyButton = screen.getByRole('button', { name: 'Copy annotations' });
    const clearButton = screen.getByRole('button', { name: 'Clear annotations' });
    const completeButton = screen.getByRole('button', { name: 'Complete annotations' });
    const settingsButton = screen.getByRole('button', { name: 'Toggle settings' });

    expect(annotateButton.getAttribute('title')).toBe('Toggle annotate mode');
    expect(drawButton.getAttribute('title')).toBe('Toggle draw mode');
    expect(copyButton.getAttribute('title')).toBe('Copy annotations');
    expect(clearButton.getAttribute('title')).toBe('Clear annotations');
    expect(completeButton.getAttribute('title')).toBe('Copy, clear, and exit capture mode');
    expect(settingsButton.getAttribute('title')).toBe('Toggle settings');

    expect(screen.queryByText('Modes')).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();
    expect(screen.queryByText('Annotate')).toBeNull();
    expect(screen.queryByText('Draw')).toBeNull();
    expect(screen.queryByText('Copy')).toBeNull();
    expect(screen.queryByText('Clear')).toBeNull();
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('shows annotate mode hint popup with default Shift guidance', async () => {
    renderToolbar({ isAnnotateMode: true, multiSelectCount: 0 });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));

    expect(screen.getByText('Tip: hold Shift and click to multi-select elements.')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('Hint')).toBeNull();
  });

  it('shows selected count guidance while multi-select is in progress', async () => {
    renderToolbar({ isAnnotateMode: true, multiSelectCount: 3 });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));

    expect(screen.getByText('Shift multi-select: 3 selected. Release Shift to annotate all.')).toBeTruthy();
  });

  it('shows draw mode hint popup when draw mode is active', async () => {
    renderToolbar({ isDrawMode: true, drawShape: 'ellipse' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));

    expect(screen.getByText('Drag to draw a ellipse region.')).toBeTruthy();
    expect(screen.queryByText('Hint')).toBeNull();
  });

  it('auto-enables annotate mode when the panel is expanded from collapsed', async () => {
    const onToggleAnnotateMode = vi.fn();
    renderToolbar({ isAnnotateMode: false, isDrawMode: false, onToggleAnnotateMode });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));

    expect(onToggleAnnotateMode).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Tip: hold Shift and click to multi-select elements.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Toggle annotate mode' }).className).toContain('is-active');
  });

  it('does not auto-toggle annotate mode when already annotating', async () => {
    const onToggleAnnotateMode = vi.fn();
    renderToolbar({ isAnnotateMode: true, onToggleAnnotateMode });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));

    expect(onToggleAnnotateMode).not.toHaveBeenCalled();
  });

  it('delegates Escape handling to app-level callback once per key press', async () => {
    const onEscape = vi.fn();
    renderToolbar({ isAnnotateMode: true, onEscape });
    const user = userEvent.setup();

    await user.keyboard('{Escape}');

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('clears annotations after successful copy when clear-on-copy is enabled', async () => {
    const onClearAnnotations = vi.fn();
    renderToolbar({
      clearOnCopy: true,
      onClearAnnotations,
      annotations: [createAnnotation('1')],
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));
    await user.click(screen.getByRole('button', { name: 'Copy annotations' }));

    expect(onClearAnnotations).toHaveBeenCalledTimes(1);
  });

  it('copies annotations before invoking complete', async () => {
    const onComplete = vi.fn();
    renderToolbar({
      onComplete,
      annotations: [createAnnotation('1')],
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));
    await user.click(screen.getByRole('button', { name: 'Complete annotations' }));

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not invoke complete when copy fails', async () => {
    vi.mocked(copyToClipboard).mockResolvedValueOnce(false);
    const onComplete = vi.fn();
    renderToolbar({
      onComplete,
      annotations: [createAnnotation('1')],
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));
    await user.click(screen.getByRole('button', { name: 'Complete annotations' }));

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('disables complete when there are no annotations', async () => {
    renderToolbar();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));

    expect(
      (screen.getByRole('button', {
        name: 'Complete annotations',
      }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('updates clear-on-copy setting from settings panel checkbox', async () => {
    const onClearOnCopyChange = vi.fn();
    renderToolbar({ onClearOnCopyChange });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));
    await user.click(screen.getByRole('button', { name: 'Toggle settings' }));
    await user.click(screen.getByLabelText('Clear on copy'));

    expect(onClearOnCopyChange).toHaveBeenCalledWith(true);
  });

  it('renders draw controls and shape tools without palette toggle', async () => {
    const onToggleDrawMode = vi.fn();
    const onSelectDrawShape = vi.fn();

    renderToolbar({
      isDrawMode: true,
      drawShape: 'rectangle',
      onToggleDrawMode,
      onSelectDrawShape,
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));

    await user.click(screen.getByRole('button', { name: 'Toggle draw mode' }));
    expect(onToggleDrawMode).toHaveBeenCalledTimes(1);

    expect(screen.queryByLabelText('Toggle draw palette')).toBeNull();

    const rectangleButton = screen.getByLabelText('Draw rectangle');
    const ellipseButton = screen.getByLabelText('Draw ellipse');
    expect(rectangleButton).toBeTruthy();
    expect(ellipseButton).toBeTruthy();
    expect(screen.queryByText('Rectangle')).toBeNull();
    expect(screen.queryByText('Ellipse')).toBeNull();

    await user.click(ellipseButton);
    expect(onSelectDrawShape).toHaveBeenCalledWith('ellipse');
  });

  it('calls annotate toggle from Annotate control in draw-active state', async () => {
    const onToggleAnnotateMode = vi.fn();
    renderToolbar({
      isAnnotateMode: false,
      isDrawMode: true,
      onToggleAnnotateMode,
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Toggle onUI panel' }));
    await user.click(screen.getByRole('button', { name: 'Toggle annotate mode' }));

    expect(onToggleAnnotateMode).toHaveBeenCalledTimes(1);
  });
});
