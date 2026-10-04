import { Injectable } from '@nestjs/common';
import { GoogleLoginProvider } from './google-login.provider';
import { WechatLoginProvider } from './wechat-login.provider';
import { webLoginConfig } from '@gitroom/helpers/auth/web-login.config';
import type { WebLoginProvider } from './web-login.provider';

@Injectable()
export class WebLoginService {
  private readonly providers: WebLoginProvider[];
  constructor(google: GoogleLoginProvider, wechat: WechatLoginProvider) {
    this.providers = [google, wechat];
  }
  getProvider(id: string) {
    const provider = this.providers.find((item) => item.id === id);
    if (!provider || !webLoginConfig(provider.id).enabled) return undefined;
    return provider;
  }
}
