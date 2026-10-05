'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import Chart from 'chart.js/auto';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { PlatformAnalytics } from '@gitroom/frontend/components/platform-analytics/platform.analytics';
import { WebsiteConnectButton, readWebsiteResponse } from './website-connect';

type Metrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};
type Row = Metrics & { keys: string[] };
type Report = {
  totals: Metrics | null;
  trend: Row[];
  rows: Row[];
  hasNext: boolean;
  updatedAt: string;
  startDate: string;
  endDate: string;
};
const metrics: { key: keyof Metrics; label: string }[] = [
  { key: 'clicks', label: '点击量' },
  { key: 'impressions', label: '曝光量' },
  { key: 'ctr', label: '点击率' },
  { key: 'position', label: '平均排名' },
];
const dimensions = [
  { key: 'query', label: '关键词' },
  { key: 'page', label: '页面' },
  { key: 'country', label: '国家' },
  { key: 'device', label: '设备' },
];
const format = (value: number, metric: keyof Metrics) =>
  metric === 'ctr'
    ? `${(value * 100).toFixed(2)}%`
    : value.toLocaleString(undefined, {
        maximumFractionDigits: metric === 'position' ? 2 : 0,
      });

function range(days: number) {
  // Search Console dates are Pacific dates, independent of the browser timezone.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const end = new Date(
    `${part('year')}-${part('month')}-${part('day')}T00:00:00Z`
  );
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function Trend({ rows, metric }: { rows: Row[]; metric: keyof Metrics }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const chart = new Chart(canvas.current, {
      type: 'line',
      data: {
        labels: rows.map((row) => row.keys[0]),
        datasets: [
          {
            label: metrics.find((m) => m.key === metric)!.label,
            data: rows.map((row) =>
              metric === 'ctr' ? row.ctr * 100 : row[metric]
            ),
            borderColor: '#9b7bff',
            backgroundColor: '#9b7bff22',
            fill: true,
            tension: 0.2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { reverse: metric === 'position' } },
        plugins: { legend: { display: false } },
      },
    });
    return () => chart.destroy();
  }, [rows, metric]);
  return (
    <div className="h-64">
      <canvas
        role="img"
        aria-label={`${metrics.find((m) => m.key === metric)!.label}每日趋势`}
        ref={canvas}
      />
    </div>
  );
}

export function WebsiteAnalytics() {
  const fetch = useFetch();
  const load = useCallback(
    (url: string) => fetch(url).then(readWebsiteResponse),
    [fetch]
  );
  const {
    data: connections,
    error: listError,
    mutate,
  } = useSWR<{
    enabled: boolean;
    websites: { id: string; siteUrl: string; reconnectRequired: boolean }[];
  }>('/website-analytics', load);
  const [id, setId] = useState('');
  const selected =
    connections?.websites.find((site) => site.id === id) ||
    connections?.websites[0];
  const [period, setPeriod] = useState('28');
  const [dates, setDates] = useState(() => range(28));
  const [draft, setDraft] = useState(dates);
  const [dimension, setDimension] = useState('query');
  const [page, setPage] = useState(0);
  const [metric, setMetric] = useState<keyof Metrics>('clicks');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const query = new URLSearchParams({
    ...dates,
    dimension,
    page: String(page),
  });
  const {
    data,
    error: reportError,
    isLoading,
    mutate: reload,
  } = useSWR<Report>(
    selected
      ? `/website-analytics/connections/${selected.id}/report?${query}`
      : null,
    load,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const control =
    'rounded-lg border border-tableBorder bg-newBgColorInner px-3 py-2';
  return (
    <section className="flex flex-col gap-5 p-5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">独立站 · 搜索表现</h1>
          <p className="text-gray-400 mt-2">
            来自 Google Search Console · 仅数据观测
          </p>
        </div>
        <WebsiteConnectButton disabled={connections?.enabled === false} />
      </div>
      {listError && <p role="alert">{listError.message}</p>}
      {!connections && !listError && <p role="status">正在读取网站…</p>}
      {connections?.enabled === false && (
        <p role="status" className="p-4 rounded-lg bg-newTableHeader">
          管理员尚未配置 Search Console 授权，请完成服务端配置后绑定网站。
        </p>
      )}
      {connections && !connections.websites.length && (
        <div className="p-12 text-center rounded-xl bg-newTableHeader">
          <h2 className="text-xl mb-3">绑定网站，了解搜索带来的关注</h2>
          <p>
            查看点击、曝光、关键词与热门页面。请使用已拥有网站 Search Console
            权限的 Google 账号。
          </p>
        </div>
      )}
      {selected && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="选择网站"
              className={`${control} max-w-full`}
              value={selected.id}
              onChange={(e) => {
                setId(e.target.value);
                setPage(0);
                setConfirmDelete(false);
                setError('');
              }}
            >
              {connections!.websites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.siteUrl}
                </option>
              ))}
            </select>
            <WebsiteConnectButton
              reconnectId={selected.id}
              disabled={!connections?.enabled}
            />
            <button className={control} onClick={() => setConfirmDelete(true)}>
              解除绑定
            </button>
          </div>
          {confirmDelete && (
            <div className="p-4 border border-tableBorder rounded-lg flex flex-wrap items-center gap-3">
              <p>
                解除 {selected.siteUrl} 的绑定？只移除本系统连接，Search Console
                网站不受影响。
              </p>
              <button
                className={control}
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setError('');
                  try {
                    await readWebsiteResponse(
                      await fetch(
                        `/website-analytics/connections/${selected.id}`,
                        { method: 'DELETE' }
                      )
                    );
                    setConfirmDelete(false);
                    setId('');
                    setPage(0);
                    await mutate();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? '正在解除…' : '确认解除'}
              </button>
              <button
                className={control}
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-3 items-center">
            <select
              aria-label="日期范围"
              className={control}
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                if (e.target.value !== 'custom') {
                  const next = range(Number(e.target.value));
                  setDates(next);
                  setDraft(next);
                  setPage(0);
                }
              }}
            >
              <option value="7">近 7 天</option>
              <option value="28">近 28 天</option>
              <option value="90">近 90 天</option>
              <option value="custom">自定义日期</option>
            </select>
            {period === 'custom' && (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setDates(draft);
                  setPage(0);
                }}
              >
                <input
                  required
                  aria-label="开始日期"
                  type="date"
                  className={control}
                  value={draft.startDate}
                  max={draft.endDate}
                  onChange={(e) =>
                    setDraft({ ...draft, startDate: e.target.value })
                  }
                />
                <input
                  required
                  aria-label="结束日期"
                  type="date"
                  className={control}
                  value={draft.endDate}
                  min={draft.startDate}
                  max={range(1).endDate}
                  onChange={(e) =>
                    setDraft({ ...draft, endDate: e.target.value })
                  }
                />
                <button className={control} type="submit">
                  应用
                </button>
              </form>
            )}
            <span className="text-sm text-gray-400">
              {dates.startDate} — {dates.endDate} · 太平洋时间 · 网页搜索
            </span>
          </div>
          {(error || reportError) && (
            <div role="alert" className="p-4 border border-red-400 rounded-lg">
              {error || reportError.message}
              <button
                className="underline ms-4"
                onClick={() => {
                  setError('');
                  void reload();
                }}
              >
                重试
              </button>
            </div>
          )}
          {isLoading && <p role="status">正在读取搜索表现…</p>}
          {data && !reportError && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {metrics.map((item) => (
                  <button
                    aria-pressed={metric === item.key}
                    key={item.key}
                    onClick={() => setMetric(item.key)}
                    className={`text-start p-5 rounded-xl border ${
                      metric === item.key
                        ? 'border-purple-400 bg-newTableHeader'
                        : 'border-tableBorder'
                    }`}
                  >
                    <div className="text-gray-400">{item.label}</div>
                    <div className="text-3xl mt-2">
                      {data.totals
                        ? format(data.totals[item.key], item.key)
                        : '—'}
                    </div>
                  </button>
                ))}
              </div>
              {!data.totals ? (
                <p className="p-8 text-center bg-newTableHeader rounded-xl">
                  所选范围暂无已完成处理的搜索数据。新网站或最近日期可能尚无数据。
                </p>
              ) : (
                <Trend rows={data.trend} metric={metric} />
              )}
              <div
                className="flex flex-wrap gap-2"
                role="tablist"
                aria-label="数据维度"
              >
                {dimensions.map((item) => (
                  <button
                    role="tab"
                    aria-selected={dimension === item.key}
                    className={`${control} ${
                      dimension === item.key ? 'text-purple-400' : ''
                    }`}
                    key={item.key}
                    onClick={() => {
                      setDimension(item.key);
                      setPage(0);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto border border-tableBorder rounded-xl">
                <table className="w-full text-sm text-start">
                  <thead className="bg-newTableHeader">
                    <tr>
                      <th className="text-start p-3">
                        {dimensions.find((d) => d.key === dimension)!.label}
                      </th>
                      {metrics.map((m) => (
                        <th
                          className="text-end p-3 whitespace-nowrap"
                          key={m.key}
                        >
                          {m.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr
                        key={row.keys[0]}
                        className="border-t border-tableBorder"
                      >
                        <td className="p-3 break-all min-w-48 max-w-xl">
                          {row.keys[0]}
                        </td>
                        {metrics.map((m) => (
                          <td
                            key={m.key}
                            className="p-3 text-end whitespace-nowrap"
                          >
                            {format(row[m.key], m.key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.rows.length && (
                  <p className="p-5 text-center">此维度暂无可显示的明细。</p>
                )}
              </div>
              <div className="flex gap-3 items-center">
                <button
                  className={control}
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </button>
                <span>第 {page + 1} 页</span>
                <button
                  className={control}
                  disabled={!data.hasNext}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
              <p className="text-sm text-gray-400">
                缓存更新：{new Date(data.updatedAt).toLocaleString()}（缓存 1
                小时）。仅展示 Google
                已完成处理的数据，最新日期可能尚不完整。明细为热门结果，并非完整清单，不能用明细相加计算总量。
              </p>
            </>
          )}
        </>
      )}
      <p className="text-sm text-gray-400">
        这里展示 Google 搜索表现。全站访客、订单及销售额需使用 GA4
        等其他数据源。
      </p>
    </section>
  );
}

export function AnalyticsWithWebsites() {
  const [tab, setTab] = useState('social');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'websites')
      setTab('websites');
  }, []);
  return (
    <div className="flex flex-col w-full min-w-0">
      <nav
        className="flex gap-3 px-5 py-3 border-b border-tableBorder"
        aria-label="分析类型"
      >
        {[
          { key: 'social', label: '社交平台' },
          { key: 'websites', label: '独立站' },
        ].map((item) => (
          <button
            key={item.key}
            aria-current={tab === item.key ? 'page' : undefined}
            className={`px-4 py-2 rounded-lg ${
              tab === item.key ? 'bg-newTableHeader text-purple-400' : ''
            }`}
            onClick={() => {
              setTab(item.key);
              window.history.replaceState(
                null,
                '',
                `/analytics?tab=${item.key}`
              );
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {tab === 'websites' ? <WebsiteAnalytics /> : <PlatformAnalytics />}
    </div>
  );
}
