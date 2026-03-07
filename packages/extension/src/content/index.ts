/**
 * Content script entry point
 */

import { renderApp } from './render';
import { suppressOnUiDebugLogs } from '@/shared/logging';

// Keep onUI debug logs opt-in in production builds.
suppressOnUiDebugLogs();
console.log('[onUI] Content script loaded');

declare global {
  interface Window {
    __ONUI_CONTENT_BOOTSTRAPPED__?: boolean;
    __ONUI_CONTENT_PING_LISTENER_REGISTERED__?: boolean;
  }
}

if (!window.__ONUI_CONTENT_BOOTSTRAPPED__) {
  window.__ONUI_CONTENT_BOOTSTRAPPED__ = true;
  // Initialize the UI once per page context.
  renderApp();
}

if (!window.__ONUI_CONTENT_PING_LISTENER_REGISTERED__) {
  window.__ONUI_CONTENT_PING_LISTENER_REGISTERED__ = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as { type?: unknown } | null)?.type;
    if (type !== 'ONUI_PING') {
      return undefined;
    }

    sendResponse({ ok: true, bootstrapped: true });
    return false;
  });
}
