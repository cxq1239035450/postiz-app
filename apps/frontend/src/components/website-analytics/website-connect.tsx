'use client';

import { useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import Link from 'next/link';

export async function readWebsiteResponse(response: Response) {
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.message === 'string' ? data.message : '请求失败，请稍后重试。'
    );
  return data;
}

export function WebsiteConnectButton({
  reconnectId,
  disabled = false,
}: {
  reconnectId?: string;
  disabled?: boolean;
}) {
  const fetch = useFetch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div>
      <button
        disabled={busy || disabled}
        className="rounded-lg bg-forth text-white px-4 py-2 disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const { url } = await readWebsiteResponse(
              await fetch('/website-analytics/authorize', {
                method: 'POST',
                body: JSON.stringify({ reconnectId }),
              })
            );
            window.location.assign(url);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? '正在连接…' : reconnectId ? '重新授权' : '绑定网站'}
      </button>
      {error && (
        <p role="alert" className="text-red-400 mt-2">
          {error}
        </p>
      )}
    </div>
  );
}

export function WebsiteConnect() {
  const fetch = useFetch();
  const started = useRef(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    ticket: string;
    sites: { siteUrl: string; permissionLevel: string }[];
  }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const body = {
      state: params.get('state'),
      code: params.get('code'),
      error: params.get('error'),
    };
    // Remove the authorization code from the visible URL and browser history.
    window.history.replaceState(null, '', window.location.pathname);
    if (!body.state) {
      setError('授权链接无效，请重新绑定网站。');
      return;
    }
    fetch('/website-analytics/callback', {
      method: 'POST',
      body: JSON.stringify(body),
    })
      .then(readWebsiteResponse)
      .then((data) => {
        if (data.reconnected)
          window.location.replace('/analytics?tab=websites');
        else setResult(data);
      })
      .catch((e) => setError(e.message));
  }, [fetch]);

  return (
    <section className="max-w-3xl mx-auto w-full p-8 flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">绑定独立站</h1>
      <p className="text-gray-400">
        选择你要观测的 Search Console 网站。仅访问搜索表现数据，不启用发布。
      </p>
      {error && (
        <div role="alert" className="rounded-lg border border-red-400 p-4">
          {error}
          <div className="mt-3">
            <WebsiteConnectButton />
          </div>
        </div>
      )}
      {!result && !error && <p role="status">正在读取 Google 授权的网站…</p>}
      {result && (
        <>
          {!result.sites.length ? (
            <p>
              此账号暂无可访问的网站。请先在{' '}
              <a
                className="underline"
                href="https://search.google.com/search-console"
                target="_blank"
                rel="noreferrer"
              >
                Search Console
              </a>{' '}
              添加并验证网站，或让网站所有者为此账号授予访问权限，然后重新绑定。
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                {result.sites.map((site) => (
                  <label
                    key={site.siteUrl}
                    className="flex items-center gap-3 p-4 rounded-lg bg-newTableHeader break-all"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(site.siteUrl)}
                      onChange={(e) =>
                        setSelected((old) =>
                          e.target.checked
                            ? [...old, site.siteUrl]
                            : old.filter((url) => url !== site.siteUrl)
                        )
                      }
                    />
                    <span>
                      {site.siteUrl}
                      <small className="block text-gray-400">
                        {site.siteUrl.startsWith('sc-domain:')
                          ? '域名资源'
                          : 'URL 前缀资源'}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <button
                disabled={!selected.length || busy}
                className="self-start bg-forth text-white rounded-lg px-5 py-3 disabled:opacity-50"
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await readWebsiteResponse(
                      await fetch('/website-analytics/connections', {
                        method: 'POST',
                        body: JSON.stringify({
                          ticket: result.ticket,
                          siteUrls: selected,
                        }),
                      })
                    );
                    window.location.replace('/analytics?tab=websites');
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(false);
                  }
                }}
              >
                {busy ? '正在绑定…' : `绑定 ${selected.length} 个网站`}
              </button>
            </>
          )}
        </>
      )}
      <Link className="underline" href="/analytics?tab=websites">
        返回独立站数据
      </Link>
    </section>
  );
}
