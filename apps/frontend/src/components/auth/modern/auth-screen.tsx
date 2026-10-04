'use client';
import { FormEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { QPublishBrand } from '@gitroom/frontend/components/ui/qpublish-brand';
import { GoogleLogin } from './providers/google-login';
import { WechatLogin } from './providers/wechat-login';
import styles from './auth.module.css';

const callbackErrors: Record<string, string> = {
  provider_unavailable: '此登录方式暂未开放，请使用邮箱登录。',
  invalid_state: '授权已过期或登录窗口已变化，请重新登录。',
  access_denied: '你已取消授权，可以重新选择登录方式。',
  registration_disabled: '当前未开放新账号注册，请联系管理员。',
  login_failed: '第三方登录未成功，请重试或使用邮箱登录。',
};

export function AuthScreen({
  mode = 'login',
  providers,
  allowRegistration = true,
  termsUrl,
  privacyUrl,
}: {
  mode?: 'login' | 'register';
  providers: { google: boolean; wechat: boolean };
  allowRegistration?: boolean;
  termsUrl: string;
  privacyUrl: string;
}) {
  const register = mode === 'register';
  const query = useSearchParams();
  const [error, setError] = useState(
    callbackErrors[query.get('error') || ''] || ''
  );
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [activation, setActivation] = useState(false);
  const busy = useRef(false);
  const fetchData = useFetch();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = new FormData(event.currentTarget);
    busy.current = true;
    setLoading(true);
    setError('');
    setActivation(false);
    try {
      const response = await fetchData(
        register ? '/auth/register' : '/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({
            email: String(form.get('email')).trim().toLowerCase(),
            password: String(form.get('password')),
            provider: 'LOCAL',
            providerToken: '',
            ...(register
              ? { company: String(form.get('company')).trim() }
              : {}),
          }),
        }
      );
      if (!response.ok) {
        const text = await response.text();
        if (text === 'User is not activated') {
          setActivation(true);
          setError('账号尚未激活，请查收激活邮件。');
        } else {
          setError(
            text.includes('Email already exists')
              ? '此邮箱已注册，请直接登录。'
              : text.includes('Registration is disabled')
              ? callbackErrors.registration_disabled
              : response.status === 400
              ? register
                ? '注册失败，请检查填写内容后重试。'
                : '邮箱或密码不正确，请重试。'
              : '服务暂时不可用，请稍后重试。'
          );
        }
        return;
      }
      if (response.headers.get('activate') === 'true')
        window.location.assign('/auth/activate');
      else if (
        !response.headers.get('reload') &&
        !response.headers.get('onboarding')
      )
        window.location.assign('/');
    } catch {
      setError('无法连接登录服务，请检查网络后重试。');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  return (
    <main className={styles.screen} lang="zh-CN">
      <aside className={styles.story} aria-label="QPublish 多平台发布">
        <Link
          className={styles.brand}
          href="/auth/login"
          aria-label="QPublish 登录首页"
        >
          <QPublishBrand wordmark />
        </Link>
        <div className={styles.storyBody}>
          <h2>
            让好内容，
            <br />
            被更多人看见。
          </h2>
          <p>连接你的平台，让创作与发布更从容。</p>
          <img
            className={styles.art}
            src="/auth/publishing.png"
            width="1536"
            height="1024"
            alt="连接 Instagram、Facebook、TikTok 和 YouTube 的内容发布示意"
          />
        </div>
        <p className={styles.storyFooter}>创作 · 排期 · 发布</p>
      </aside>
      <section className={styles.formPanel} aria-labelledby="auth-title">
        <Link className={styles.mobileBrand} href="/auth/login">
          <QPublishBrand wordmark />
        </Link>
        <div className={styles.formContent}>
          <h1 id="auth-title">{register ? '开启你的创作' : '欢迎回来'}</h1>
          <p className={styles.subtitle}>
            {register
              ? '创建 QPublish 账号，让发布更从容。'
              : '登录 QPublish，继续你的创作。'}
          </p>
          <div className={styles.providers} aria-label="第三方登录">
            <GoogleLogin
              available={providers.google}
              onError={setError}
              disabled={loading}
            />
            <WechatLogin
              available={providers.wechat}
              onError={setError}
              disabled={loading}
            />
          </div>
          <div className={styles.divider}>
            <span>或使用邮箱{register ? '注册' : '登录'}</span>
          </div>
          {error && (
            <div className={styles.error} role="alert">
              {error}
              {activation && (
                <Link href="/auth/activate">重新发送激活邮件</Link>
              )}
            </div>
          )}
          <form onSubmit={submit} className={styles.form} aria-busy={loading}>
            <label htmlFor="auth-email">邮箱</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="请输入邮箱地址"
              required
              maxLength={254}
              disabled={loading}
            />
            <label htmlFor="auth-password">密码</label>
            <div className={styles.password}>
              <input
                id="auth-password"
                name="password"
                type={visible ? 'text' : 'password'}
                autoComplete={register ? 'new-password' : 'current-password'}
                placeholder="请输入密码"
                required
                minLength={3}
                maxLength={register ? 64 : undefined}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setVisible(!visible)}
                aria-label={visible ? '隐藏密码' : '显示密码'}
                aria-pressed={visible}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                  {visible && <path d="m3 3 18 18" />}
                </svg>
              </button>
            </div>
            {register ? (
              <>
                <label htmlFor="auth-company">团队 / 公司</label>
                <input
                  id="auth-company"
                  name="company"
                  autoComplete="organization"
                  placeholder="请输入团队或公司名称"
                  required
                  minLength={3}
                  maxLength={128}
                  disabled={loading}
                />
              </>
            ) : (
              <Link href="/auth/forgot" className={styles.forgot}>
                忘记密码？
              </Link>
            )}
            {register && (
              <p className={styles.agreement}>
                注册即表示你同意{' '}
                <a href={termsUrl} target="_blank" rel="noreferrer">
                  服务条款
                </a>{' '}
                和{' '}
                <a href={privacyUrl} target="_blank" rel="noreferrer">
                  隐私政策
                </a>
                。
              </p>
            )}
            <button className={styles.submit} type="submit" disabled={loading}>
              {loading ? '正在处理…' : register ? '创建账号' : '登录'}
            </button>
          </form>
          <p className={styles.switchMode}>
            {register ? (
              <>
                已有账号？ <Link href="/auth/login">立即登录</Link>
              </>
            ) : allowRegistration ? (
              <>
                还没有账号？ <Link href="/auth">创建账号</Link>
              </>
            ) : (
              '新账号注册暂未开放'
            )}
          </p>
        </div>
        <footer className={styles.legal}>
          <a href={termsUrl} target="_blank" rel="noreferrer">
            服务条款
          </a>
          <span>·</span>
          <a href={privacyUrl} target="_blank" rel="noreferrer">
            隐私政策
          </a>
        </footer>
      </section>
    </main>
  );
}
