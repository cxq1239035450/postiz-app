'use client';
import { ReactNode, useEffect, useState } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import styles from '../auth.module.css';

export type ProviderButtonProps = {
  available: boolean;
  onError: (message: string) => void;
  disabled?: boolean;
};

export function ProviderButton({
  id,
  name,
  icon,
  available,
  onError,
  disabled,
}: ProviderButtonProps & {
  id: 'google' | 'wechat';
  name: string;
  icon: ReactNode;
}) {
  const { backendUrl } = useVariables();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  return (
    <button
      type="button"
      className={styles.provider}
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={() => {
        if (!available) {
          onError(`${name} 登录暂未开放，请使用邮箱登录。`);
          return;
        }
        setPending(true);
        window.location.assign(
          `${backendUrl.replace(/\/$/, '')}/auth/social/${id}/start`
        );
      }}
    >
      {icon}
      <span>
        {pending
          ? '正在前往授权…'
          : `使用${id === 'google' ? ' Google ' : '微信'}登录`}
      </span>
    </button>
  );
}
