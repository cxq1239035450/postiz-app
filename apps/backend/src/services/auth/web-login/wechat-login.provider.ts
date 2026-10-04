import { Injectable } from '@nestjs/common';
import { webLoginConfig } from '@gitroom/helpers/auth/web-login.config';
import { LoginTransaction, WebLoginProvider } from './web-login.provider';

type WechatToken = { access_token?: string; openid?: string; errcode?: number };
type WechatUser = { openid?: string; nickname?: string; errcode?: number };

@Injectable()
export class WechatLoginProvider implements WebLoginProvider {
  readonly id = 'wechat';

  authorizationUrl(transaction: LoginTransaction) {
    const config = webLoginConfig(this.id);
    const params = new URLSearchParams({
      appid: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'snsapi_login',
      state: transaction.state,
    });
    return `https://open.weixin.qq.com/connect/qrconnect?${params}#wechat_redirect`;
  }

  async exchange(code: string, _transaction: LoginTransaction) {
    const config = webLoginConfig(this.id);
    const params = new URLSearchParams({
      appid: config.clientId,
      secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
    });
    // Secrets and tokens are exchanged only on the server, never returned to the UI.
    const tokenResponse = await fetch(
      `https://api.weixin.qq.com/sns/oauth2/access_token?${params}`,
      {
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!tokenResponse.ok) throw new Error('WeChat token exchange failed');
    const token = (await tokenResponse.json()) as WechatToken;
    if (token.errcode || !token.access_token || !token.openid) {
      throw new Error('Invalid WeChat code');
    }
    const userParams = new URLSearchParams({
      access_token: token.access_token,
      openid: token.openid,
      lang: 'zh_CN',
    });
    const userResponse = await fetch(
      `https://api.weixin.qq.com/sns/userinfo?${userParams}`,
      {
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!userResponse.ok) throw new Error('WeChat identity request failed');
    const identity = (await userResponse.json()) as WechatUser;
    if (identity.errcode || identity.openid !== token.openid) {
      throw new Error('Invalid WeChat identity');
    }
    // OpenID is scoped to this website AppID. Do not switch between OpenID and
    // UnionID opportunistically: that would create duplicate accounts later.
    return {
      id: `${config.clientId}:${identity.openid}`,
      name: identity.nickname,
    };
  }
}
