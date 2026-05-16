import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('background site activation runtime state', () => {
  const tabId = 42;
  let localStorageBucket: Record<string, unknown>;
  let sessionStorageBucket: Record<string, unknown>;
  let grantedOrigins: Set<string>;
  let tabsById: Map<number, chrome.tabs.Tab>;
  let scriptingExecuteScriptMock: ReturnType<typeof vi.fn>;
  let runtimeOnMessageListener:
    | ((
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void
      ) => boolean | undefined)
    | null;
  let tabsOnUpdatedListener:
    | ((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void)
    | null;

  function storageGet(bucket: Record<string, unknown>) {
    return vi.fn(async (keys?: string | string[] | Record<string, unknown>) => {
      if (typeof keys === 'string') {
        return { [keys]: bucket[keys] };
      }

      if (Array.isArray(keys)) {
        return keys.reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = bucket[key];
          return acc;
        }, {});
      }

      return bucket;
    });
  }

  beforeEach(() => {
    vi.resetModules();
    localStorageBucket = {};
    sessionStorageBucket = {};
    grantedOrigins = new Set();
    tabsById = new Map([
      [tabId, { id: tabId, url: 'https://app.example.com/dashboard' } as chrome.tabs.Tab],
      [77, { id: 77, url: 'edge://extensions' } as chrome.tabs.Tab],
    ]);
    runtimeOnMessageListener = null;
    tabsOnUpdatedListener = null;

    scriptingExecuteScriptMock = vi.fn(async (injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => {
      if ('func' in injection && typeof injection.func === 'function') {
        return [{ result: false }];
      }

      return [];
    });

    Object.defineProperty(globalThis, 'chrome', {
      value: {
        tabs: {
          get: vi.fn(async (id: number) => tabsById.get(id)),
          query: vi.fn(async (query: chrome.tabs.QueryInfo) => {
            const pattern = typeof query.url === 'string' ? query.url : null;
            if (!pattern) {
              return Array.from(tabsById.values());
            }

            const patternUrl = new URL(pattern.replace('/*', '/'));
            return Array.from(tabsById.values()).filter((tab) => {
              if (!tab.url) return false;
              const tabUrl = new URL(tab.url);
              return tabUrl.protocol === patternUrl.protocol && tabUrl.hostname === patternUrl.hostname;
            });
          }),
          sendMessage: vi.fn(async (_id: number, message: { type?: string }) => {
            if (message.type === 'ONUI_PING') {
              throw new Error('No receiver');
            }
            return { ok: true };
          }),
          onRemoved: {
            addListener: vi.fn(),
          },
          onUpdated: {
            addListener: vi.fn((listener) => {
              tabsOnUpdatedListener = listener;
            }),
          },
        },
        runtime: {
          sendMessage: vi.fn(async () => undefined),
          onMessage: {
            addListener: vi.fn((listener) => {
              runtimeOnMessageListener = listener;
            }),
          },
        },
        scripting: {
          executeScript: scriptingExecuteScriptMock,
        },
        permissions: {
          contains: vi.fn(async (permissions: chrome.permissions.Permissions) =>
            (permissions.origins ?? []).every((origin) => grantedOrigins.has(origin))
          ),
          remove: vi.fn(async (permissions: chrome.permissions.Permissions) => {
            for (const origin of permissions.origins ?? []) {
              grantedOrigins.delete(origin);
            }
            return true;
          }),
        },
        storage: {
          local: {
            get: storageGet(localStorageBucket),
            set: vi.fn(async (items: Record<string, unknown>) => {
              Object.assign(localStorageBucket, items);
            }),
          },
          session: {
            get: storageGet(sessionStorageBucket),
            set: vi.fn(async (items: Record<string, unknown>) => {
              Object.assign(sessionStorageBucket, items);
            }),
          },
        },
      },
      configurable: true,
    });
  });

  it('combines per-tab and site activation into effective runtime state', async () => {
    const { stateManager } = await import('./state');
    const { storageService } = await import('./storage');
    const { getEffectiveTabRuntimeState } = await import('./messages');

    expect(await getEffectiveTabRuntimeState(tabId, 'https://app.example.com/dashboard')).toMatchObject({
      enabled: false,
      tabEnabled: false,
      siteEnabled: false,
      origin: 'https://app.example.com',
    });

    await stateManager.setTabEnabled(tabId, true);
    expect(await getEffectiveTabRuntimeState(tabId, 'https://app.example.com/dashboard')).toMatchObject({
      enabled: true,
      tabEnabled: true,
      siteEnabled: false,
    });

    await stateManager.setTabEnabled(tabId, false);
    await storageService.setSiteEnabled('https://app.example.com', true);
    grantedOrigins.add('https://app.example.com/*');

    expect(await getEffectiveTabRuntimeState(tabId, 'https://app.example.com/dashboard')).toMatchObject({
      enabled: true,
      tabEnabled: false,
      siteEnabled: true,
      origin: 'https://app.example.com',
    });
  });

  it('does not treat stored site activation as effective without host permission', async () => {
    const { storageService } = await import('./storage');
    const { getEffectiveTabRuntimeState } = await import('./messages');

    await storageService.setSiteEnabled('https://app.example.com', true);

    expect(await getEffectiveTabRuntimeState(tabId, 'https://app.example.com/dashboard')).toMatchObject({
      enabled: false,
      tabEnabled: false,
      siteEnabled: false,
    });
  });

  it('injects content after navigation completes for a site-enabled origin', async () => {
    const { storageService } = await import('./storage');
    const { setupMessageHandler } = await import('./messages');

    await storageService.setSiteEnabled('https://app.example.com', true);
    grantedOrigins.add('https://app.example.com/*');

    setupMessageHandler();
    tabsOnUpdatedListener?.(tabId, { status: 'complete' }, tabsById.get(tabId)!);

    await vi.waitFor(() => {
      expect(scriptingExecuteScriptMock).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId },
          files: ['content-script.js'],
        })
      );
    });
  });

  it('injects content into a specific frame when requested', async () => {
    const { ensureContentScriptInjected } = await import('./messages');

    await ensureContentScriptInjected(tabId, { frameId: 3 });

    await vi.waitFor(() => {
      expect(scriptingExecuteScriptMock).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId, frameIds: [3] },
          files: ['content-script.js'],
        })
      );
    });
  });

  it('keeps host permission while a same-origin tab remains enabled', async () => {
    const { stateManager } = await import('./state');
    const { storageService } = await import('./storage');
    const { setupMessageHandler } = await import('./messages');

    await storageService.setSiteEnabled('https://app.example.com', true);
    await stateManager.setTabEnabled(tabId, true);
    grantedOrigins.add('https://app.example.com/*');

    setupMessageHandler();
    expect(runtimeOnMessageListener).not.toBeNull();

    await new Promise<void>((resolve) => {
      runtimeOnMessageListener?.(
        {
          type: 'SET_SITE_ENABLED',
          payload: {
            tabId,
            origin: 'https://app.example.com',
            enabled: false,
          },
        },
        { tab: tabsById.get(tabId)! } as chrome.runtime.MessageSender,
        () => resolve()
      );
    });

    expect(grantedOrigins.has('https://app.example.com/*')).toBe(true);
    expect(chrome.permissions.remove).not.toHaveBeenCalled();
    expect(await storageService.isSiteEnabled('https://app.example.com')).toBe(false);
    expect(await stateManager.getTabRuntimeState(tabId)).toMatchObject({
      enabled: true,
    });
  });

  it('skips reinjection for unsupported URLs', async () => {
    const { setupMessageHandler } = await import('./messages');

    setupMessageHandler();
    tabsOnUpdatedListener?.(77, { status: 'complete' }, tabsById.get(77)!);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scriptingExecuteScriptMock).not.toHaveBeenCalled();
  });
});
