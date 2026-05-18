// Based on OpenCLI (https://github.com/jackwener/opencli) by jackwener
// Licensed under Apache-2.0. Modified for AutoCLI.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener<T extends (...args: any[]) => void> = { addListener: (fn: T) => void };

type MockTab = {
  id: number;
  windowId: number;
  url?: string;
  title?: string;
  active?: boolean;
  status?: string;
};

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_url: string) {}
  send(_data: string): void {}
  close(): void {
    this.onclose?.();
  }
}

function createChromeMock() {
  let nextTabId = 10;
  let debuggerEventListener: ((source: { tabId?: number }, method: string, params?: any) => void) | null = null;
  const tabUpdatedListeners: Array<(id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void> = [];
  const tabs: MockTab[] = [
    { id: 1, windowId: 1, url: 'https://automation.example', title: 'automation', active: true, status: 'complete' },
    { id: 2, windowId: 2, url: 'https://user.example', title: 'user', active: true, status: 'complete' },
    { id: 3, windowId: 1, url: 'chrome://extensions', title: 'chrome', active: false, status: 'complete' },
  ];

  const query = vi.fn(async (queryInfo: { windowId?: number } = {}) => {
    return tabs.filter((tab) => queryInfo.windowId === undefined || tab.windowId === queryInfo.windowId);
  });
  const create = vi.fn(async ({ windowId, url, active }: { windowId?: number; url?: string; active?: boolean }) => {
    const tab: MockTab = {
      id: nextTabId++,
      windowId: windowId ?? 999,
      url,
      title: url ?? 'blank',
      active: !!active,
      status: 'complete',
    };
    tabs.push(tab);
    return tab;
  });
  const update = vi.fn(async (tabId: number, updates: { active?: boolean; url?: string }) => {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) throw new Error(`Unknown tab ${tabId}`);
    if (updates.active !== undefined) tab.active = updates.active;
    if (updates.url !== undefined) tab.url = updates.url;
    return tab;
  });
  const reload = vi.fn(async (tabId: number) => {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) throw new Error(`Unknown tab ${tabId}`);
    tab.status = 'loading';
    setTimeout(() => {
      tab.status = 'complete';
      for (const listener of [...tabUpdatedListeners]) {
        listener(tabId, { status: 'complete' }, tab as chrome.tabs.Tab);
      }
    }, 0);
  });

  const debuggerApi = {
    attach: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
    sendCommand: vi.fn(async (_target: unknown, method: string) => {
      if (method === 'Network.getResponseBody') return { body: '{"ok":true}', base64Encoded: false };
      return {};
    }),
    onEvent: {
      addListener: vi.fn((fn: (source: { tabId?: number }, method: string, params?: any) => void) => {
        debuggerEventListener = fn;
      }),
    },
    onDetach: { addListener: vi.fn() } as Listener<() => void>,
  };

  const chrome = {
    tabs: {
      query,
      create,
      update,
      reload,
      move: vi.fn(async (tabId: number, moveProperties: { windowId: number }) => {
        const tab = tabs.find((entry) => entry.id === tabId);
        if (!tab) throw new Error(`Unknown tab ${tabId}`);
        tab.windowId = moveProperties.windowId;
        return [tab];
      }),
      remove: vi.fn(async (_tabId: number) => {}),
      get: vi.fn(async (tabId: number) => {
        const tab = tabs.find((entry) => entry.id === tabId);
        if (!tab) throw new Error(`Unknown tab ${tabId}`);
        return tab;
      }),
      onRemoved: { addListener: vi.fn() } as Listener<(tabId: number) => void>,
      onUpdated: {
        addListener: vi.fn((fn: (id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) => {
          tabUpdatedListeners.push(fn);
        }),
        removeListener: vi.fn((fn: (id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) => {
          const index = tabUpdatedListeners.indexOf(fn);
          if (index >= 0) tabUpdatedListeners.splice(index, 1);
        }),
      } as Listener<(id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void>,
    },
    windows: {
      get: vi.fn(async (windowId: number) => ({ id: windowId })),
      create: vi.fn(async ({ url, focused, width, height, type }: any) => ({ id: 1, url, focused, width, height, type })),
      remove: vi.fn(async (_windowId: number) => {}),
      onRemoved: { addListener: vi.fn() } as Listener<(windowId: number) => void>,
    },
    alarms: {
      create: vi.fn(),
      onAlarm: { addListener: vi.fn() } as Listener<(alarm: { name: string }) => void>,
    },
    runtime: {
      getManifest: vi.fn(() => ({ version: 'test' })),
      onInstalled: { addListener: vi.fn() } as Listener<() => void>,
      onStartup: { addListener: vi.fn() } as Listener<() => void>,
      onMessage: { addListener: vi.fn() } as Listener<(msg: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => boolean | void>,
      onConnect: { addListener: vi.fn() } as Listener<(port: unknown) => void>,
    },
    cookies: {
      getAll: vi.fn(async () => []),
    },
    debugger: debuggerApi,
    scripting: {
      executeScript: vi.fn(async () => [{ result: false }]),
    },
    action: {
      onClicked: { addListener: vi.fn() } as Listener<(tab: { id?: number }) => void>,
    },
  };

  return { chrome, tabs, query, create, update, reload, debuggerApi, getDebuggerEventListener: () => debuggerEventListener };
}

describe('background tab isolation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  });

  it('lists only automation-window web tabs', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:twitter', 1);

    const result = await mod.__test__.handleTabs({ id: '1', action: 'tabs', op: 'list', workspace: 'site:twitter' }, 'site:twitter');

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      {
        index: 0,
        tabId: 1,
        url: 'https://automation.example',
        title: 'automation',
        active: true,
      },
    ]);
  });

  it('creates new tabs inside the automation window', async () => {
    const { chrome, create } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:twitter', 1);

    const result = await mod.__test__.handleTabs({ id: '2', action: 'tabs', op: 'new', url: 'https://new.example', workspace: 'site:twitter' }, 'site:twitter');

    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledWith({ windowId: 1, url: 'https://new.example', active: true });
  });

  it('captures passive network response bodies and removes sensitive metadata', async () => {
    const { chrome, debuggerApi, getDebuggerEventListener } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:goofish', 1);

    const started = await mod.__test__.handleNetworkCapture({
      id: '4',
      action: 'network-capture',
      op: 'start',
      pattern: 'mtop.taobao.idlemtopsearch.pc.search',
      bodyLimit: 200,
      workspace: 'site:goofish',
    }, 'site:goofish');
    expect(started.ok).toBe(true);
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Network.enable', {});

    const listener = getDebuggerEventListener();
    expect(listener).toBeTruthy();
    listener?.({ tabId: 1 }, 'Network.responseReceived', {
      requestId: 'req-1',
      type: 'Fetch',
      response: {
        url: 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/?jsv=2&api=mtop.taobao.idlemtopsearch.pc.search&v=1.0&type=json&dataType=json&data=%7B%22secret%22%3Atrue%7D&_m_h5_tk=token',
        status: 200,
        headers: {
          'content-type': 'application/json;charset=UTF-8',
          'set-cookie': 'secret=1',
          authorization: 'Bearer secret',
          'x-extra-debug': 'drop-me',
        },
      },
    });
    listener?.({ tabId: 1 }, 'Network.loadingFinished', { requestId: 'req-1' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const collected = await mod.__test__.handleNetworkCapture({
      id: '5',
      action: 'network-capture',
      op: 'collect',
      clear: true,
      workspace: 'site:goofish',
    }, 'site:goofish');

    expect(collected.ok).toBe(true);
    expect(collected.data).toEqual([
      {
        url: 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/?api=mtop.taobao.idlemtopsearch.pc.search&v=1.0&type=json&dataType=json',
        method: 'GET',
        headers: { 'content-type': 'application/json;charset=UTF-8' },
        status: 200,
        response_body: '{"ok":true}',
      },
    ]);
    expect(JSON.stringify(collected.data)).not.toContain('_m_h5_tk');
    expect(JSON.stringify(collected.data)).not.toContain('secret=1');
    expect(JSON.stringify(collected.data)).not.toContain('Bearer secret');
  });

  it('captures matching mtop responses even when Chrome classifies them as script resources', async () => {
    const { chrome, getDebuggerEventListener } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:goofish', 1);

    const started = await mod.__test__.handleNetworkCapture({
      id: '6',
      action: 'network-capture',
      op: 'start',
      pattern: 'mtop.taobao.idlemtopsearch.pc.search',
      workspace: 'site:goofish',
    }, 'site:goofish');
    expect(started.ok).toBe(true);

    const listener = getDebuggerEventListener();
    listener?.({ tabId: 1 }, 'Network.responseReceived', {
      requestId: 'jsonp-1',
      type: 'Script',
      response: {
        url: 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/?api=mtop.taobao.idlemtopsearch.pc.search&v=1.0&type=jsonp&dataType=jsonp',
        status: 200,
        headers: {
          'content-type': 'application/javascript;charset=UTF-8',
        },
      },
    });
    listener?.({ tabId: 1 }, 'Network.loadingFinished', { requestId: 'jsonp-1' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const collected = await mod.__test__.handleNetworkCapture({
      id: '7',
      action: 'network-capture',
      op: 'collect',
      clear: true,
      workspace: 'site:goofish',
    }, 'site:goofish');

    expect(collected.ok).toBe(true);
    const responses = collected.data as Array<Record<string, unknown>>;
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      url: 'https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/?api=mtop.taobao.idlemtopsearch.pc.search&v=1.0&type=jsonp&dataType=jsonp',
      status: 200,
      response_body: '{"ok":true}',
    });
  });

  it('reloads an already-loaded target URL while passive network capture is active', async () => {
    const { chrome, tabs, reload } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:goofish', 1);
    const targetUrl = 'https://www.goofish.com/search?q=AI%E6%99%BA%E8%83%BD%E4%BD%93%E5%AE%9A%E5%88%B6';
    tabs[0].url = targetUrl;
    tabs[0].status = 'complete';

    const started = await mod.__test__.handleNetworkCapture({
      id: '8',
      action: 'network-capture',
      op: 'start',
      pattern: 'mtop.taobao.idlemtopsearch.pc.search',
      workspace: 'site:goofish',
    }, 'site:goofish');
    expect(started.ok).toBe(true);

    const result = await mod.__test__.handleNavigate({
      id: '9',
      action: 'navigate',
      url: targetUrl,
      workspace: 'site:goofish',
    }, 'site:goofish');

    expect(result.ok).toBe(true);
    expect(reload).toHaveBeenCalledWith(1, { bypassCache: true });
  });

  it('reports sessions per workspace', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:twitter', 1);
    mod.__test__.setAutomationWindowId('site:zhihu', 2);

    const result = await mod.__test__.handleSessions({ id: '3', action: 'sessions' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ workspace: 'site:twitter', windowId: 1 }),
      expect.objectContaining({ workspace: 'site:zhihu', windowId: 2 }),
    ]));
  });
});
