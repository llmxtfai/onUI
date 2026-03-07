import { describe, expect, it } from 'vitest';
import { getDataDir, getNativeHostManifestPath, getNativeHostWindowsRegistryPath, getStorePath } from './path.js';

describe('path resolver', () => {
  it('respects ONUI_STORE_PATH override', () => {
    const previous = process.env.ONUI_STORE_PATH;
    process.env.ONUI_STORE_PATH = '/tmp/onui-store/custom.v1.json';

    try {
      expect(getStorePath('linux')).toBe('/tmp/onui-store/custom.v1.json');
      expect(getStorePath('win32')).toBe('/tmp/onui-store/custom.v1.json');
      expect(getStorePath('darwin')).toBe('/tmp/onui-store/custom.v1.json');
    } finally {
      if (previous === undefined) {
        delete process.env.ONUI_STORE_PATH;
      } else {
        process.env.ONUI_STORE_PATH = previous;
      }
    }
  });

  it('resolves darwin paths', () => {
    const dataDir = getDataDir('darwin');
    expect(dataDir).toContain('Library/Application Support/onui');
    expect(getStorePath('darwin')).toContain('store.v1.json');
    expect(getNativeHostManifestPath('darwin', 'chrome')).toContain('Google/Chrome/NativeMessagingHosts/com.onui.native.json');
    expect(getNativeHostManifestPath('darwin', 'edge')).toContain(
      'Microsoft Edge/NativeMessagingHosts/com.onui.native.json'
    );
  });

  it('resolves linux paths', () => {
    const dataDir = getDataDir('linux');
    expect(dataDir).toContain('onui');
    expect(getStorePath('linux')).toContain('store.v1.json');
    expect(getNativeHostManifestPath('linux', 'chrome')).toContain(
      'google-chrome/NativeMessagingHosts/com.onui.native.json'
    );
    expect(getNativeHostManifestPath('linux', 'edge')).toContain(
      'microsoft-edge/NativeMessagingHosts/com.onui.native.json'
    );
  });

  it('resolves browser-specific windows registry paths', () => {
    expect(getNativeHostWindowsRegistryPath('chrome')).toContain(
      'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.onui.native'
    );
    expect(getNativeHostWindowsRegistryPath('edge')).toContain(
      'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.onui.native'
    );
  });
});
