import type { Message, MessageResponse, SitePreferenceState, TabRuntimeState } from '@/types';
import { webext } from '@/shared/webext';
import { getSitePermissionPattern, getSupportedSiteOrigin, isSupportedSiteUrl } from '@/shared/site-activation';
import { annotationManager } from './annotations';
import { getNativeSyncStatus } from './native-sync';
import { storageService } from './storage';
import { stateManager } from './state';

const LOG_PREFIX = '[onUI][background][messages]';
const CONTENT_SCRIPT_ENTRY_FILE = 'content-script.js';
const CONTENT_SCRIPT_PING_MESSAGE = 'ONUI_PING';
const contentScriptInjectionInFlight = new Map<number, Promise<void>>();

interface ContentScriptInjectionOptions {
  frameId?: number;
}

function isInjectableTabUrl(url?: string): boolean {
  return isSupportedSiteUrl(url);
}

async function isContentScriptBootstrapped(
  tabId: number,
  options: ContentScriptInjectionOptions = {}
): Promise<boolean> {
  try {
    const results = await webext.scripting.executeScript({
      target: {
        tabId,
        ...(typeof options.frameId === 'number' ? { frameIds: [options.frameId] } : {}),
      },
      func: () =>
        (globalThis as { __ONUI_CONTENT_BOOTSTRAPPED__?: boolean }).__ONUI_CONTENT_BOOTSTRAPPED__ ===
        true,
    });
    return results.some((result) => result.result === true);
  } catch {
    return false;
  }
}

async function isContentScriptReachable(
  tabId: number,
  options: ContentScriptInjectionOptions = {}
): Promise<boolean> {
  try {
    const message = {
      type: CONTENT_SCRIPT_PING_MESSAGE,
    } as { type: string };
    const response =
      typeof options.frameId === 'number'
        ? await webext.tabs.sendMessage(tabId, message, { frameId: options.frameId })
        : await webext.tabs.sendMessage(tabId, message);
    return Boolean((response as { ok?: boolean } | undefined)?.ok);
  } catch {
    return false;
  }
}

async function runWithInjectionLock(tabId: number, task: () => Promise<void>): Promise<void> {
  const inFlight = contentScriptInjectionInFlight.get(tabId);
  if (inFlight) {
    await inFlight;
    return;
  }

  const next = (async () => {
    try {
      await task();
    } finally {
      contentScriptInjectionInFlight.delete(tabId);
    }
  })();
  contentScriptInjectionInFlight.set(tabId, next);
  await next;
}

export async function ensureContentScriptInjected(
  tabId: number,
  options: ContentScriptInjectionOptions = {}
): Promise<void> {
  const tab = await webext.tabs.get(tabId);
  if (!isInjectableTabUrl(tab.url)) {
    throw new Error('onUI can only run on http/https pages.');
  }

  await runWithInjectionLock(tabId, async () => {
    // Fast path: if content script is already responding, skip executeScript.
    const isReachable = await isContentScriptReachable(tabId, options);
    if (isReachable) {
      return;
    }

    // Avoid duplicate executeScript() calls in the same page context.
    const alreadyBootstrapped = await isContentScriptBootstrapped(tabId, options);
    if (alreadyBootstrapped) {
      return;
    }

    // Inject content script only after explicit user action.
    await webext.scripting.executeScript({
      target: {
        tabId,
        ...(typeof options.frameId === 'number' ? { frameIds: [options.frameId] } : {}),
      },
      files: [CONTENT_SCRIPT_ENTRY_FILE],
    });
  });
}

async function getTabUrl(tabId: number, sender?: chrome.runtime.MessageSender): Promise<string | undefined> {
  if (sender?.tab?.id === tabId && sender.tab.url) {
    return sender.tab.url;
  }

  try {
    const tab = await webext.tabs.get(tabId);
    return tab.url;
  } catch {
    return undefined;
  }
}

async function hasSitePermission(permissionPattern: string | null): Promise<boolean> {
  if (!permissionPattern || !webext.permissions?.contains) {
    return false;
  }

  try {
    return await webext.permissions.contains({ origins: [permissionPattern] });
  } catch {
    return false;
  }
}

async function getSitePreferenceForUrl(url?: string): Promise<SitePreferenceState> {
  const origin = getSupportedSiteOrigin(url);
  return getSitePreferenceForOrigin(origin);
}

async function getSitePreferenceForOrigin(origin: string | null): Promise<SitePreferenceState> {
  const permissionPattern = getSitePermissionPattern(origin ?? undefined);

  if (!origin || !permissionPattern) {
    return {
      origin: null,
      enabled: false,
      hasPermission: false,
      permissionPattern: null,
    };
  }

  const [enabled, hasPermission] = await Promise.all([
    storageService.isSiteEnabled(origin),
    hasSitePermission(permissionPattern),
  ]);

  return {
    origin,
    enabled,
    hasPermission,
    permissionPattern,
  };
}

async function getSitePreferenceForTab(
  tabId: number,
  sender?: chrome.runtime.MessageSender
): Promise<SitePreferenceState> {
  return getSitePreferenceForUrl(await getTabUrl(tabId, sender));
}

export async function getEffectiveTabRuntimeState(
  tabId: number,
  url?: string
): Promise<TabRuntimeState> {
  const tabState = await stateManager.getTabRuntimeState(tabId);
  const sitePreference = await getSitePreferenceForUrl(url ?? (await getTabUrl(tabId)));
  const siteEnabled = sitePreference.enabled && sitePreference.hasPermission;
  const enabled = tabState.enabled || siteEnabled;

  return {
    enabled,
    annotateMode: enabled ? tabState.annotateMode : false,
    tabEnabled: tabState.enabled,
    siteEnabled,
    ...(sitePreference.origin ? { origin: sitePreference.origin } : {}),
  };
}

async function getTabsForOrigin(origin: string): Promise<chrome.tabs.Tab[]> {
  const permissionPattern = getSitePermissionPattern(origin);
  if (!permissionPattern) {
    return [];
  }

  try {
    const tabs = await webext.tabs.query({ url: permissionPattern });
    return tabs.filter((tab) => getSupportedSiteOrigin(tab.url) === origin);
  } catch {
    return [];
  }
}

async function notifyTabsForOrigin(origin: string, injectEnabledTabs: boolean): Promise<void> {
  const tabs = await getTabsForOrigin(origin);
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== 'number') {
        return;
      }

      const state = await getEffectiveTabRuntimeState(tab.id, tab.url);
      if (injectEnabledTabs && state.enabled) {
        try {
          await ensureContentScriptInjected(tab.id);
        } catch (error) {
          console.warn(`${LOG_PREFIX} site activation injection skipped`, {
            tabId: tab.id,
            error: error instanceof Error ? error.message : 'unknown error',
          });
        }
      }

      await notifyTabRuntimeStateChanged(tab.id, tab.url);
    })
  );
}

async function removeSitePermissionIfUnused(permissionPattern: string | null): Promise<void> {
  if (!permissionPattern || !webext.permissions?.remove) {
    return;
  }

  const sitePreferences = await storageService.getSitePreferences();
  const stillUsed = Object.keys(sitePreferences).some(
    (origin) => getSitePermissionPattern(origin) === permissionPattern
  );
  if (stillUsed) {
    return;
  }

  let origin: string | null = null;
  try {
    origin = new URL(permissionPattern.replace('/*', '/')).origin;
  } catch {
    origin = null;
  }

  if (origin) {
    const tabs = await getTabsForOrigin(origin);
    const hasEnabledTabs = await Promise.all(
      tabs.map(async (tab) => {
        if (typeof tab.id !== 'number') {
          return false;
        }

        const tabState = await stateManager.getTabRuntimeState(tab.id);
        return tabState.enabled === true;
      })
    );

    if (hasEnabledTabs.some(Boolean)) {
      return;
    }
  }

  try {
    await webext.permissions.remove({ origins: [permissionPattern] });
  } catch {
    // Permission removal is best-effort; users can also manage grants in browser UI.
  }
}

async function reInjectContentScriptIfEnabled(tabId: number, url?: string): Promise<void> {
  const state = await getEffectiveTabRuntimeState(tabId, url);
  if (!state.enabled || !isInjectableTabUrl(url)) {
    return;
  }

  try {
    await ensureContentScriptInjected(tabId);
  } catch (error) {
    console.warn(`${LOG_PREFIX} reinjection skipped`, {
      tabId,
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
}

async function notifyTabRuntimeStateChanged(tabId: number, url?: string): Promise<void> {
  const state = await getEffectiveTabRuntimeState(tabId, url);
  const payload = {
    type: 'TAB_RUNTIME_STATE_CHANGED' as const,
    payload: { tabId, state },
    meta: { source: 'background' as const, sentAt: Date.now() },
  };

  try {
    await webext.tabs.sendMessage(tabId, payload);
  } catch {
    // Content script may not be available for this tab URL; ignore.
  }

  try {
    await webext.runtime.sendMessage(payload);
  } catch {
    // Popup/extension page listeners may not exist; ignore.
  }
}

function sanitizeUrlForLog(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

/**
 * Handle incoming messages from content scripts and popup
 * Uses async IIFE pattern to ensure sendResponse is always called
 * even if the service worker becomes inactive (Manifest V3 limitation)
 */
export function setupMessageHandler(): void {
  webext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') {
      return;
    }
    void reInjectContentScriptIfEnabled(tabId, tab.url);
  });

  webext.runtime.onMessage.addListener(
    (
      message: Message,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: MessageResponse) => void
    ) => {
      const requestId = message.meta?.requestId ?? `bg-${Date.now()}`;
      const receivedAt = Date.now();

      console.log(`${LOG_PREFIX} ${requestId} received`, {
        type: message.type,
        senderTabId: sender.tab?.id,
        senderUrl: sanitizeUrlForLog(sender.tab?.url),
        source: message.meta?.source,
      });

      // Wrap in async IIFE to ensure sendResponse is called
      (async () => {
        try {
          const response = await handleMessage(message, sender, requestId, receivedAt);

          console.log(`${LOG_PREFIX} ${requestId} responding`, {
            type: message.type,
            durationMs: Date.now() - receivedAt,
            success: response.success,
            error: response.error,
          });

          sendResponse(response);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          console.error(`${LOG_PREFIX} ${requestId} handler failed`, {
            type: message.type,
            durationMs: Date.now() - receivedAt,
            error: errorMessage,
          });

          sendResponse({
            success: false,
            error: errorMessage,
          });
        }
      })();

      // Return true to indicate async response
      return true;
    }
  );
}

/**
 * Route messages to appropriate handlers
 * Note: For GET_STATE and SET_STATE, tabId is extracted from sender.tab.id
 * since content scripts cannot access chrome.tabs API
 */
async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender,
  requestId: string,
  receivedAt: number
): Promise<MessageResponse> {
  switch (message.type) {
    case 'GET_ANNOTATIONS': {
      const annotations = await annotationManager.getAnnotations(message.payload.url);
      console.log(`${LOG_PREFIX} ${requestId} GET_ANNOTATIONS completed`, {
        durationMs: Date.now() - receivedAt,
        count: annotations.length,
      });
      return { success: true, data: annotations };
    }

    case 'CREATE_ANNOTATION': {
      const annotation = await annotationManager.createAnnotation(message.payload);
      console.log(`${LOG_PREFIX} ${requestId} CREATE_ANNOTATION completed`, {
        durationMs: Date.now() - receivedAt,
        annotationId: annotation.id,
      });
      return { success: true, data: annotation };
    }

    case 'CREATE_ANNOTATIONS_BULK': {
      const annotations = await annotationManager.createAnnotationsBulk(message.payload.inputs);
      console.log(`${LOG_PREFIX} ${requestId} CREATE_ANNOTATIONS_BULK completed`, {
        durationMs: Date.now() - receivedAt,
        count: annotations.length,
      });
      return { success: true, data: annotations };
    }

    case 'UPDATE_ANNOTATION': {
      const updated = await annotationManager.updateAnnotation(
        message.payload.id,
        message.payload.update,
        requestId
      );
      if (!updated) {
        return { success: false, error: 'Annotation not found' };
      }
      console.log(`${LOG_PREFIX} ${requestId} UPDATE_ANNOTATION completed`, {
        durationMs: Date.now() - receivedAt,
        annotationId: updated.id,
      });
      return { success: true, data: updated };
    }

    case 'DELETE_ANNOTATION': {
      const deleted = await annotationManager.deleteAnnotation(message.payload.id, requestId);
      if (!deleted) {
        return { success: false, error: 'Annotation not found' };
      }
      console.log(`${LOG_PREFIX} ${requestId} DELETE_ANNOTATION completed`, {
        durationMs: Date.now() - receivedAt,
      });
      return { success: true };
    }

    case 'CLEAR_ANNOTATIONS': {
      await annotationManager.clearAnnotations(message.payload.url, requestId);
      console.log(`${LOG_PREFIX} ${requestId} CLEAR_ANNOTATIONS completed`, {
        durationMs: Date.now() - receivedAt,
        url: sanitizeUrlForLog(message.payload.url),
      });
      return { success: true };
    }

    case 'GET_SETTINGS': {
      const settings = await storageService.getSettings();
      console.log(`${LOG_PREFIX} ${requestId} GET_SETTINGS completed`, {
        durationMs: Date.now() - receivedAt,
      });
      return { success: true, data: settings };
    }

    case 'GET_SYNC_STATUS': {
      const status = getNativeSyncStatus();
      console.log(`${LOG_PREFIX} ${requestId} GET_SYNC_STATUS completed`, {
        durationMs: Date.now() - receivedAt,
        status: status.status,
      });
      return { success: true, data: status };
    }

    case 'UPDATE_SETTINGS': {
      const settings = await storageService.updateSettings(message.payload);
      console.log(`${LOG_PREFIX} ${requestId} UPDATE_SETTINGS completed`, {
        durationMs: Date.now() - receivedAt,
      });
      return { success: true, data: settings };
    }

    case 'GET_SITE_PREFERENCE': {
      const tabId = message.payload?.tabId ?? sender.tab?.id;
      if (!tabId) {
        console.warn(`${LOG_PREFIX} ${requestId} GET_SITE_PREFERENCE no tabId, returning default`);
        return {
          success: true,
          data: {
            origin: null,
            enabled: false,
            hasPermission: false,
            permissionPattern: null,
          },
        };
      }

      const sitePreference = await getSitePreferenceForTab(tabId, sender);
      console.log(`${LOG_PREFIX} ${requestId} GET_SITE_PREFERENCE completed`, {
        durationMs: Date.now() - receivedAt,
        tabId,
        origin: sitePreference.origin,
        enabled: sitePreference.enabled,
        hasPermission: sitePreference.hasPermission,
      });
      return { success: true, data: sitePreference };
    }

    case 'SET_SITE_ENABLED': {
      const tabId = message.payload?.tabId ?? sender.tab?.id;
      if (!tabId) {
        console.warn(`${LOG_PREFIX} ${requestId} SET_SITE_ENABLED no tabId`);
        return { success: false, error: 'Missing tabId for SET_SITE_ENABLED' };
      }

      const payloadOrigin = getSupportedSiteOrigin(message.payload.origin);
      const sitePreference = payloadOrigin
        ? await getSitePreferenceForOrigin(payloadOrigin)
        : await getSitePreferenceForTab(tabId, sender);
      if (!sitePreference.origin || !sitePreference.permissionPattern) {
        return { success: false, error: 'onUI can only run on http/https pages.' };
      }

      if (message.payload.enabled && !sitePreference.hasPermission) {
        return {
          success: false,
          error: 'Permission is required to always enable onUI for this site.',
        };
      }

      await storageService.setSiteEnabled(sitePreference.origin, message.payload.enabled);

      if (message.payload.enabled) {
        try {
          await ensureContentScriptInjected(tabId);
        } catch (error) {
          await storageService.setSiteEnabled(sitePreference.origin, false);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to inject content script',
          };
        }
      }

      await notifyTabsForOrigin(sitePreference.origin, message.payload.enabled);

      if (!message.payload.enabled) {
        await removeSitePermissionIfUnused(sitePreference.permissionPattern);
      }

      const nextSitePreference = await getSitePreferenceForTab(tabId, sender);
      const runtimeState = await getEffectiveTabRuntimeState(tabId, await getTabUrl(tabId, sender));

      console.log(`${LOG_PREFIX} ${requestId} SET_SITE_ENABLED completed`, {
        durationMs: Date.now() - receivedAt,
        tabId,
        origin: nextSitePreference.origin,
        enabled: nextSitePreference.enabled,
        hasPermission: nextSitePreference.hasPermission,
        runtimeState,
      });
      return {
        success: true,
        data: {
          site: nextSitePreference,
          runtimeState,
        },
      };
    }

    case 'GET_TAB_RUNTIME_STATE': {
      const tabId = message.payload?.tabId ?? sender.tab?.id;
      if (!tabId) {
        console.warn(`${LOG_PREFIX} ${requestId} GET_TAB_RUNTIME_STATE no tabId, returning default`);
        return {
          success: true,
          data: { enabled: false, annotateMode: false, tabEnabled: false, siteEnabled: false },
        };
      }

      const state = await getEffectiveTabRuntimeState(tabId, await getTabUrl(tabId, sender));
      console.log(`${LOG_PREFIX} ${requestId} GET_TAB_RUNTIME_STATE completed`, {
        durationMs: Date.now() - receivedAt,
        tabId,
        state,
      });
      return { success: true, data: state };
    }

    case 'SET_TAB_ENABLED': {
      const tabId = message.payload?.tabId ?? sender.tab?.id;
      if (!tabId) {
        console.warn(`${LOG_PREFIX} ${requestId} SET_TAB_ENABLED no tabId`);
        return { success: false, error: 'Missing tabId for SET_TAB_ENABLED' };
      }

      if (message.payload.enabled) {
        try {
          await ensureContentScriptInjected(tabId);
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to inject content script',
          };
        }
      }

      await stateManager.setTabEnabled(tabId, message.payload.enabled);
      const state = await getEffectiveTabRuntimeState(tabId, await getTabUrl(tabId, sender));
      await notifyTabRuntimeStateChanged(tabId, state.origin);

      console.log(`${LOG_PREFIX} ${requestId} SET_TAB_ENABLED completed`, {
        durationMs: Date.now() - receivedAt,
        tabId,
        state,
      });
      return { success: true, data: state };
    }

    case 'SET_ANNOTATE_MODE': {
      const tabId = message.payload?.tabId ?? sender.tab?.id;
      if (!tabId) {
        console.warn(`${LOG_PREFIX} ${requestId} SET_ANNOTATE_MODE no tabId`);
        return { success: false, error: 'Missing tabId for SET_ANNOTATE_MODE' };
      }

      const tabUrl = await getTabUrl(tabId, sender);
      let current = await getEffectiveTabRuntimeState(tabId, tabUrl);

      // MV3 service workers are ephemeral; recover enabled state when content is already active.
      if (!current.enabled && message.meta?.source === 'content') {
        await stateManager.setTabEnabled(tabId, true);
        current = await getEffectiveTabRuntimeState(tabId, tabUrl);
      }

      await stateManager.setAnnotateMode(tabId, message.payload.annotateMode, {
        allowWhenDisabled: current.siteEnabled === true,
      });
      const state = await getEffectiveTabRuntimeState(tabId, tabUrl);
      await notifyTabRuntimeStateChanged(tabId, tabUrl);

      console.log(`${LOG_PREFIX} ${requestId} SET_ANNOTATE_MODE completed`, {
        durationMs: Date.now() - receivedAt,
        tabId,
        state,
      });
      return { success: true, data: state };
    }

    case 'GET_STATE': {
      // Extract tabId from sender (content scripts can't access chrome.tabs)
      const tabId = message.payload?.tabId ?? sender.tab?.id;
      // Return safe default if no tabId (don't fail)
      if (!tabId) {
        console.warn(`${LOG_PREFIX} ${requestId} GET_STATE no tabId, returning default`);
        return { success: true, data: { isActive: false } };
      }
      const state = await getEffectiveTabRuntimeState(tabId, await getTabUrl(tabId, sender));
      const isActive = state.annotateMode;
      console.log(`${LOG_PREFIX} ${requestId} GET_STATE completed`, {
        durationMs: Date.now() - receivedAt,
        tabId,
        isActive,
      });
      return { success: true, data: { isActive } };
    }

    case 'SET_STATE': {
      // Extract tabId from sender (content scripts can't access chrome.tabs)
      const tabId = message.payload?.tabId ?? sender.tab?.id;
      // Return failure if no tabId so caller can handle rollback
      if (!tabId) {
        console.warn(`${LOG_PREFIX} ${requestId} SET_STATE no tabId`);
        return { success: false, error: 'Missing tabId for SET_STATE' };
      }
      const tabUrl = await getTabUrl(tabId, sender);
      const current = await getEffectiveTabRuntimeState(tabId, tabUrl);
      const state = await stateManager.setAnnotateMode(tabId, message.payload.isActive, {
        allowWhenDisabled: current.siteEnabled === true,
      });
      await notifyTabRuntimeStateChanged(tabId, tabUrl);
      console.log(`${LOG_PREFIX} ${requestId} SET_STATE completed`, {
        durationMs: Date.now() - receivedAt,
        tabId,
        isActive: state.annotateMode,
      });
      return { success: true };
    }

    case 'TAB_RUNTIME_STATE_CHANGED': {
      // Event-style message broadcast by background; no-op if received back here.
      return { success: true };
    }

    default:
      return {
        success: false,
        error: `Unknown message type: ${(message as Message).type}`,
      };
  }
}
