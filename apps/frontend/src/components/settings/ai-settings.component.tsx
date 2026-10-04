'use client';

import React, { useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

type Provider = 'openai' | 'deepseek' | 'openai-compatible';
type Channel = {
  provider: Provider;
  baseURL: string;
  model: string;
  hasKey: boolean;
  apiKey?: string;
};
type Settings = {
  revision: string;
  text: Channel;
  image: Channel;
  chatModel: string;
  agentModel: string;
  classificationModel: string;
  timeout: number;
  maxRetries: number;
};
const inputClass =
  'w-full rounded-[4px] border border-fifth bg-newBgColorInner px-3 py-2 text-sm disabled:opacity-50';

export function AiSettingsComponent() {
  const fetch = useFetch();
  const user = useUser();
  const [settings, setSettings] = useState<Settings>();
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setBusy('loading');
    setError('');
    setNotice('');
    try {
      const response = await fetch('/settings/ai');
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || '加载配置失败');
      setSettings(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : '加载配置失败');
    } finally {
      setBusy('');
    }
  };
  useEffect(() => {
    if (user?.isSuperAdmin) void load();
  }, [user?.isSuperAdmin]);

  if (!user?.isSuperAdmin)
    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-[20px]">AI 模型</h3>
        <p>
          此配置影响整个实例，只有系统超级管理员可以查看和修改。工作区管理员不具备此权限。
        </p>
      </div>
    );

  const updateChannel = (role: 'text' | 'image', patch: Partial<Channel>) => {
    setNotice('');
    setError('');
    setSettings(
      (current) =>
        current && { ...current, [role]: { ...current[role], ...patch } }
    );
  };
  const payload = () =>
    settings && {
      ...settings,
      text: {
        provider: settings.text.provider,
        baseURL: settings.text.baseURL,
        model: settings.text.model,
        apiKey: settings.text.apiKey || '',
      },
      image: {
        provider: settings.image.provider,
        baseURL: settings.image.baseURL,
        model: settings.image.model,
        apiKey: settings.image.apiKey || '',
      },
    };
  const act = async (action: 'save' | 'text' | 'image') => {
    setBusy(action);
    setError('');
    setNotice('');
    try {
      const draft = payload();
      // Only send editable fields; server-owned flags are never part of the DTO.
      const body = draft && {
        revision: draft.revision,
        text: draft.text,
        image: draft.image,
        chatModel: draft.chatModel,
        agentModel: draft.agentModel,
        classificationModel: draft.classificationModel,
        timeout: draft.timeout,
        maxRetries: draft.maxRetries,
      };
      const response = await fetch(
        action === 'save' ? '/settings/ai' : `/settings/ai/test/${action}`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
      const result = await response.json();
      if (!response.ok || result.ok === false)
        throw new Error(result.message || '操作失败');
      if (action === 'save') {
        setSettings(result);
        setNotice(
          '配置已保存。请重启后端及任务进程后使用新配置；当前运行中的服务不会立即切换。'
        );
      } else setNotice(result.message);
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy('');
    }
  };

  return (
    <div
      className="flex flex-col gap-5 max-w-[900px]"
      onKeyDown={(event) => {
        // SettingsPopup wraps every tab in its profile form.
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement)
          event.preventDefault();
      }}
    >
      <div>
        <h3 className="text-[20px]">AI 模型</h3>
        <p className="mt-2 text-sm text-customColor18">
          配置整个实例使用的文字和图片服务。保存后需重启后端与任务进程。
        </p>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded border border-red-400 p-3 text-red-400"
        >
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded border border-fifth bg-sixth p-3">
          {notice}
        </div>
      )}
      {!settings && (
        <Button type="button" loading={busy === 'loading'} onClick={load}>
          重新加载配置
        </Button>
      )}
      {settings && (
        <>
          {(['text', 'image'] as const).map((role) => {
            const channel = settings[role];
            const title = role === 'text' ? '文字模型' : '图片模型';
            return (
              <fieldset
                key={role}
                disabled={!!busy}
                className="rounded-[4px] border border-fifth bg-sixth p-5 flex flex-col gap-4"
              >
                <legend className="px-2 text-base">{title}</legend>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex flex-col gap-2 text-sm">
                    供应商
                    <select
                      aria-label={`${title}供应商`}
                      className={inputClass}
                      value={channel.provider}
                      onChange={(event) => {
                        const provider = event.target.value as Provider;
                        updateChannel(role, {
                          provider,
                          apiKey: '',
                          baseURL:
                            provider === 'openai'
                              ? 'https://api.openai.com/v1'
                              : provider === 'deepseek'
                              ? 'https://api.deepseek.com'
                              : '',
                          model: '',
                        });
                      }}
                    >
                      <option value="openai">OpenAI</option>
                      {role === 'text' && (
                        <option value="deepseek">DeepSeek 官方</option>
                      )}
                      <option value="openai-compatible">
                        OpenAI 兼容接口 / 中转站
                      </option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm">
                    模型名称
                    <input
                      aria-label={`${title}名称`}
                      className={inputClass}
                      value={channel.model}
                      onChange={(event) =>
                        updateChannel(role, { model: event.target.value })
                      }
                      placeholder={
                        role === 'text'
                          ? '例如：Deepseek-v4.1-flash'
                          : '例如：chatgpt-image-latest'
                      }
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-2 text-sm">
                  API 地址（Base URL）
                  <input
                    aria-label={`${title}API 地址`}
                    type="url"
                    className={inputClass}
                    value={channel.baseURL}
                    onChange={(event) =>
                      updateChannel(role, { baseURL: event.target.value })
                    }
                    placeholder="https://example.com/v1"
                  />
                  <span className="text-xs text-customColor18">
                    填写接口根地址，不要附加
                    /chat/completions。切换地址或供应商时需重新填写密钥。
                  </span>
                </label>
                <label className="flex flex-col gap-2 text-sm">
                  API Key · {channel.hasKey ? '已配置' : '未配置'}
                  <input
                    aria-label={`${title}API Key`}
                    type="password"
                    autoComplete="new-password"
                    className={inputClass}
                    value={channel.apiKey || ''}
                    onChange={(event) =>
                      updateChannel(role, { apiKey: event.target.value })
                    }
                    placeholder={
                      channel.hasKey ? '留空保留已有密钥' : '输入 API Key'
                    }
                  />
                  <span className="text-xs text-customColor18">
                    已有密钥不会发送到浏览器。新密钥只在保存或测试时提交。
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    secondary
                    loading={busy === role}
                    onClick={() => act(role)}
                  >
                    {role === 'text' ? '测试文字模型' : '测试图片服务连接'}
                  </Button>
                  <span className="text-xs text-customColor18">
                    {role === 'text'
                      ? '使用当前表单发起一次简短请求，可能产生少量费用，不会保存。'
                      : '仅检查服务连接，不生成图片，不验证生成能力。'}
                  </span>
                </div>
              </fieldset>
            );
          })}
          <details className="rounded border border-fifth p-4">
            <summary className="cursor-pointer">
              高级设置 · 按功能指定模型
            </summary>
            <fieldset
              disabled={!!busy}
              className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              {(
                [
                  ['chatModel', '普通聊天模型'],
                  ['agentModel', 'Agent 模型'],
                  ['classificationModel', '分类模型'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-2 text-sm">
                  {label}
                  <input
                    className={inputClass}
                    value={settings[key]}
                    placeholder="留空继承文字模型"
                    onChange={(event) => {
                      setNotice('');
                      setSettings({ ...settings, [key]: event.target.value });
                    }}
                  />
                </label>
              ))}
              <label className="flex flex-col gap-2 text-sm">
                请求超时（毫秒）
                <input
                  type="number"
                  min={1000}
                  max={600000}
                  className={inputClass}
                  value={settings.timeout}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      timeout: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                请求重试次数
                <input
                  type="number"
                  min={0}
                  max={5}
                  className={inputClass}
                  value={settings.maxRetries}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      maxRetries: Number(event.target.value),
                    })
                  }
                />
              </label>
            </fieldset>
          </details>
          <p className="text-xs text-customColor18">
            高级设置中的模型名称优先于文字模型。图片模型需支持 Images
            API；普通聊天测试成功不代表工具调用可用。
          </p>
          <div className="flex gap-3">
            <Button
              type="button"
              loading={busy === 'save'}
              disabled={!!busy}
              onClick={() => act('save')}
            >
              保存配置
            </Button>
            <Button type="button" secondary disabled={!!busy} onClick={load}>
              重新加载
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
