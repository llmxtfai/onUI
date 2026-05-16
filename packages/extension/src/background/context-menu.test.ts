import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COPY_SELECTOR_INFO_CONTEXT_MENU_ID,
  COPY_SELECTOR_INFO_MESSAGE_TYPE,
} from '@/shared/context-menu-selector';

describe('selector info context menu', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('creates the Copy selector info context menu item', async () => {
    const create = vi.fn();
    const { ensureSelectorInfoContextMenu } = await import('./context-menu');

    ensureSelectorInfoContextMenu({
      create,
    } as never);

    const [options] = create.mock.calls[0] ?? [];
    expect(options).toMatchObject({
      id: COPY_SELECTOR_INFO_CONTEXT_MENU_ID,
      title: 'Copy selector info',
      contexts: ['all'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });

  it('injects the content script and forwards selector-copy requests to the clicked frame', async () => {
    const ensureContentScriptInjected = vi.fn(async () => undefined);
    const sendMessage = vi.fn(async () => ({ success: true }));
    const { handleSelectorInfoContextMenuClick } = await import('./context-menu');

    await handleSelectorInfoContextMenuClick(
      {
        menuItemId: COPY_SELECTOR_INFO_CONTEXT_MENU_ID,
        pageUrl: 'https://example.com/page',
        editable: false,
        frameId: 3,
        targetElementId: 41,
        selectionText: 'Save changes',
      } as chrome.contextMenus.OnClickData & { targetElementId: number },
      { id: 12 } as chrome.tabs.Tab,
      {
        ensureContentScriptInjected,
        sendMessage,
      }
    );

    expect(ensureContentScriptInjected).toHaveBeenCalledWith(12, { frameId: 3 });
    expect(sendMessage).toHaveBeenCalledWith(
      12,
      {
        type: COPY_SELECTOR_INFO_MESSAGE_TYPE,
        payload: {
          targetElementId: 41,
          selectionText: 'Save changes',
        },
      },
      { frameId: 3 }
    );
  });

  it('still forwards selector-copy requests when targetElementId is unavailable', async () => {
    const ensureContentScriptInjected = vi.fn(async () => undefined);
    const sendMessage = vi.fn(async () => ({ success: true }));
    const { handleSelectorInfoContextMenuClick } = await import('./context-menu');

    await handleSelectorInfoContextMenuClick(
      {
        menuItemId: COPY_SELECTOR_INFO_CONTEXT_MENU_ID,
        pageUrl: 'https://example.com/page',
        editable: false,
        frameId: 3,
        selectionText: 'Fallback text',
      } as chrome.contextMenus.OnClickData,
      { id: 12 } as chrome.tabs.Tab,
      {
        ensureContentScriptInjected,
        sendMessage,
      }
    );

    expect(ensureContentScriptInjected).toHaveBeenCalledWith(12, { frameId: 3 });
    expect(sendMessage).toHaveBeenCalledWith(
      12,
      {
        type: COPY_SELECTOR_INFO_MESSAGE_TYPE,
        payload: {
          selectionText: 'Fallback text',
        },
      },
      { frameId: 3 }
    );
  });
});
