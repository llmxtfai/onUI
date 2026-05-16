import { webext } from '@/shared/webext';
import { getRuntimeLastErrorMessage, resolveContextMenuApi } from '@/shared/context-menu-api';
import {
  COPY_SELECTOR_INFO_CONTEXT_MENU_ID,
  COPY_SELECTOR_INFO_MESSAGE_TYPE,
  type CopySelectorInfoMessage,
  type CopySelectorInfoResponse,
} from '@/shared/context-menu-selector';

const LOG_PREFIX = '[onUI][background][context-menu]';

interface SelectorInfoContextMenuClickData extends chrome.contextMenus.OnClickData {
  targetElementId?: number;
}

interface SelectorInfoContextMenuDependencies {
  ensureContentScriptInjected?: (tabId: number, options?: { frameId?: number }) => Promise<void>;
  sendMessage?: (
    tabId: number,
    message: CopySelectorInfoMessage,
    options?: { frameId?: number }
  ) => Promise<CopySelectorInfoResponse | undefined>;
  logger?: Pick<Console, 'warn' | 'error'>;
}

export function ensureSelectorInfoContextMenu(
  contextMenuApi: { create?: (...args: any[]) => unknown } = resolveContextMenuApi() ?? {}
): void {
  if (typeof contextMenuApi.create !== 'function') {
    return;
  }

  try {
    contextMenuApi.create(
      {
        id: COPY_SELECTOR_INFO_CONTEXT_MENU_ID,
        title: 'Copy selector info',
        contexts: ['all'],
        documentUrlPatterns: ['http://*/*', 'https://*/*'],
      },
      () => {
        const errorMessage = getRuntimeLastErrorMessage();
        if (errorMessage && !/duplicate/i.test(errorMessage)) {
          console.warn(`${LOG_PREFIX} failed to register menu`, { errorMessage });
        }
      }
    );
  } catch (error) {
    console.warn(`${LOG_PREFIX} failed to create menu`, {
      error: error instanceof Error ? error.message : error,
    });
  }
}

async function defaultEnsureContentScriptInjected(tabId: number): Promise<void> {
  const { ensureContentScriptInjected } = await import('./messages');
  await ensureContentScriptInjected(tabId);
}

async function defaultSendMessage(
  tabId: number,
  message: CopySelectorInfoMessage,
  options?: { frameId?: number }
): Promise<CopySelectorInfoResponse | undefined> {
  if (options) {
    return webext.tabs.sendMessage(tabId, message, options) as Promise<CopySelectorInfoResponse | undefined>;
  }

  return webext.tabs.sendMessage(tabId, message) as Promise<CopySelectorInfoResponse | undefined>;
}

export async function handleSelectorInfoContextMenuClick(
  info: SelectorInfoContextMenuClickData,
  tab?: chrome.tabs.Tab,
  dependencies: SelectorInfoContextMenuDependencies = {}
): Promise<void> {
  if (info.menuItemId !== COPY_SELECTOR_INFO_CONTEXT_MENU_ID) {
    return;
  }

  const logger = dependencies.logger ?? console;
  const tabId = tab?.id;
  if (typeof tabId !== 'number') {
    logger.warn(`${LOG_PREFIX} selector copy skipped: missing tab id`);
    return;
  }

  const targetElementId = info.targetElementId;

  const copyMessage: CopySelectorInfoMessage = {
    type: COPY_SELECTOR_INFO_MESSAGE_TYPE,
    payload: {
      ...(typeof targetElementId === 'number' ? { targetElementId } : {}),
      ...(info.selectionText !== undefined ? { selectionText: info.selectionText } : {}),
    },
  };

  const inject = dependencies.ensureContentScriptInjected ?? defaultEnsureContentScriptInjected;
  const sendMessage = dependencies.sendMessage ?? defaultSendMessage;

  await inject(tabId, info.frameId !== undefined ? { frameId: info.frameId } : undefined);
  const response = await sendMessage(
    tabId,
    copyMessage,
    info.frameId !== undefined ? { frameId: info.frameId } : undefined
  );

  if (!response?.success) {
    logger.warn(`${LOG_PREFIX} selector copy failed`, {
      tabId,
      frameId: info.frameId,
      error: response?.error,
    });
  }
}

export function setupSelectorInfoContextMenu(): void {
  const contextMenuApi = resolveContextMenuApi();
  if (!contextMenuApi?.onClicked?.addListener) {
    return;
  }

  ensureSelectorInfoContextMenu(contextMenuApi);
  webext.runtime.onInstalled.addListener(() => ensureSelectorInfoContextMenu(contextMenuApi));
  contextMenuApi.onClicked.addListener((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
    void handleSelectorInfoContextMenuClick(info as SelectorInfoContextMenuClickData, tab).catch((error) => {
      console.warn(`${LOG_PREFIX} selector copy handler failed`, {
        error: error instanceof Error ? error.message : error,
      });
    });
  });
}
