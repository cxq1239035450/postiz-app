// Server-only configuration. Never serialize secrets to the browser.
export type WebLoginProviderId = 'google' | 'wechat';

export function webLoginConfig(id: WebLoginProviderId) {
  const prefix = id === 'google' ? 'GOOGLE_LOGIN' : 'WECHAT_LOGIN';
  const clientId = process.env[`${prefix}_CLIENT_ID`] || '';
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`] || '';
  const base = (process.env.NEXT_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
  const redirectUri =
    process.env[`${prefix}_REDIRECT_URI`] ||
    `${base}/auth/social/${id}/callback`;
  const enabled =
    process.env[`${prefix}_ENABLED`] !== 'false' &&
    !!clientId &&
    !!clientSecret &&
    /^https?:\/\//.test(redirectUri);
  return { clientId, clientSecret, redirectUri, enabled };
}

export function publicWebLoginConfig() {
  return {
    google: webLoginConfig('google').enabled,
    wechat: webLoginConfig('wechat').enabled,
  };
}
