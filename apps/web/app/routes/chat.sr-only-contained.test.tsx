// @vitest-environment jsdom
// jsdom は配置を計算しないので、ページ全体が伸びないことそのものは測れない。測るのは、その前提になる構造である:
// sr-only は position:absolute なので、位置指定の祖先がスクロールのペインの内側に無いと、ペインに切り取られず画面全体を基準に置かれる。
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { json, Providers, storeTestBaseUrl, stubFetch } from '~/test-support';

import Chat from './chat';

const ChatRoute = Chat as unknown as (props: {
  loaderData: { conversationId: string | undefined };
}) => React.ReactElement;

function Harness() {
  const params = useParams();
  return <ChatRoute loaderData={{ conversationId: params.conversationId }} />;
}

function summary(id: string, unreadCount: number) {
  return {
    conversationId: id,
    startedAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:01:00.000Z',
    messages: 2,
    preview: `会話 ${id}`,
    unreadCount,
    readThrough: '2026-08-20T00:00:00.000Z',
  };
}

const POSITIONED = ['relative', 'absolute', 'fixed', 'sticky'];
const SCROLLS = ['overflow-auto', 'overflow-y-auto', 'overflow-scroll', 'overflow-y-scroll'];

const hasClass = (el: Element, names: readonly string[]) =>
  names.some((name) => el.classList.contains(name));

// sr-only の親から上へ辿り、スクロールのペインに着く前（またはペイン自身）に位置指定の祖先が在るかを返す。ペインの外に居る sr-only は対象外
function escapesItsScrollPane(srOnly: Element): boolean {
  for (let el = srOnly.parentElement; el !== null; el = el.parentElement) {
    if (hasClass(el, POSITIONED)) return false;
    if (hasClass(el, SCROLLS)) return true;
  }
  return false;
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  localStorage.clear();
  storeTestBaseUrl();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe('会話の画面の読み上げ専用の文（sr-only）', () => {
  it('会話の一覧と本文のどちらでも、スクロールのペインの外を基準に置かれない', async () => {
    stubFetch((url) => {
      if (url.includes('/approvals')) return json({ approvals: [] });
      if (url.includes('/conversations/c1')) {
        return json({
          conversationId: 'c1',
          messages: [
            { id: 'm1', at: '2026-08-20T00:00:00.000Z', role: 'inbound', text: '質問' },
            {
              id: 'm2',
              at: '2026-08-20T00:01:00.000Z',
              role: 'outbound',
              // 脚注は見出しを sr-only で出す
              text: '答え[^1]\n\n[^1]: 出典',
            },
          ],
          scanned: 2,
          reachedStart: true,
          supersededCount: 0,
          readThrough: null,
          unreadCount: 0,
        });
      }
      if (url.includes('/conversations')) {
        return json({
          conversations: [summary('c1', 0), summary('c2', 3), summary('c3', 1)],
          scanned: 3,
          reachedStart: true,
          hiddenByLimit: 0,
        });
      }
      return undefined;
    });
    const router = createMemoryRouter([{ path: '/chat/:conversationId', Component: Harness }], {
      initialEntries: ['/chat/c1'],
    });
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );

    // 両方のペインに sr-only が出るまで待つ: 出ていないまま測ると、何も調べずに通る
    await screen.findByRole('link', { name: /会話 c2.*未読 3 件/ });
    const footnoteHeading = await screen.findByRole('heading', { name: /footnote/i });
    expect(footnoteHeading.classList.contains('sr-only')).toBe(true);

    const srOnly = [...document.querySelectorAll('.sr-only')];
    const inPanes = srOnly.filter((el) => el.closest(SCROLLS.map((c) => `.${c}`).join(',')));
    expect(inPanes).toContain(footnoteHeading);
    expect(inPanes.some((el) => el.textContent?.includes('未読 3 件'))).toBe(true);

    const escaping = inPanes.filter(escapesItsScrollPane).map((el) => el.textContent);
    expect(escaping).toEqual([]);
  });
});
