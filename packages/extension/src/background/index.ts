/**
 * Background service worker entry point
 */

import { setupMessageHandler } from './messages';
import { bootstrapNativeSync } from './native-sync';
import { suppressOnUiDebugLogs } from '@/shared/logging';
import { webext } from '@/shared/webext';

// Keep onUI debug logs opt-in in production builds.
suppressOnUiDebugLogs();
console.log('[onUI] Background service worker initialized');

// Set up message handling
setupMessageHandler();
void bootstrapNativeSync();

// Listen for extension install/update
webext.runtime.onInstalled.addListener((details) => {
  console.log('[onUI] Extension installed/updated:', details.reason);
});
