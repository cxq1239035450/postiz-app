import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response, CookieOptions } from 'express';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { WebLoginService } from '@gitroom/backend/services/auth/web-login/web-login.service';
import {
  createLoginTransaction,
  verifyLoginTransaction,
  LOGIN_TRANSACTION_SECONDS,
} from '@gitroom/backend/services/auth/web-login/login-transaction';

@Controller('/auth/social')
@UseGuards(ThrottlerRealIpGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class WebLoginController {
  constructor(
    private readonly providers: WebLoginService,
    private readonly auth: AuthService
  ) {}

  private frontend() {
    return process.env.FRONTEND_URL!.replace(/\/$/, '');
  }

  private transactionCookie(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.frontend().startsWith('https://'),
      path: '/',
    };
  }

  private fail(response: Response, error: string) {
    return response.redirect(
      303,
      `${this.frontend()}/auth/login?error=${error}`
    );
  }

  @Get('/:provider/start')
  start(@Param('provider') id: string, @Res() response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const provider = this.providers.getProvider(id);
    if (!provider) return this.fail(response, 'provider_unavailable');
    const { transaction, cookie } = createLoginTransaction(provider.id);
    response.cookie(`qpublish_login_${id}`, cookie, {
      ...this.transactionCookie(),
      maxAge: LOGIN_TRANSACTION_SECONDS * 1000,
    });
    return response.redirect(302, provider.authorizationUrl(transaction));
  }

  @Get('/:provider/callback')
  async callback(
    @Param('provider') id: string,
    @Query() query: Record<string, unknown>,
    @Req() request: Request,
    @Res() response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const provider = this.providers.getProvider(id);
    if (!provider) return this.fail(response, 'provider_unavailable');
    const cookieName = `qpublish_login_${id}`;
    response.clearCookie(cookieName, this.transactionCookie());
    let transaction;
    try {
      transaction = verifyLoginTransaction(
        id,
        query.state,
        request.cookies?.[cookieName]
      );
    } catch {
      return this.fail(response, 'invalid_state');
    }
    if (query.error) return this.fail(response, 'access_denied');
    if (
      typeof query.code !== 'string' ||
      !query.code ||
      query.code.length > 4096
    ) {
      return this.fail(response, 'access_denied');
    }
    try {
      const identity = await provider.exchange(query.code, transaction);
      const result = await this.auth.loginVerifiedIdentity(
        provider.id === 'google' ? 'GOOGLE' : 'WECHAT',
        identity,
        ip,
        userAgent,
        request.cookies?.org
      );
      const secure = this.frontend().startsWith('https://');
      const cookieOptions: CookieOptions = {
        domain: getCookieUrlFromDomain(this.frontend()),
        // Match the existing explicitly insecure development mode, whose fetch
        // wrapper transports auth via a JS-readable cookie/header.
        path: '/',
        httpOnly: !process.env.NOT_SECURED,
        secure,
        sameSite: secure ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 365,
      };
      response.cookie('auth', result.jwt, cookieOptions);
      if (result.addedOrg && typeof result.addedOrg !== 'boolean') {
        response.cookie(
          'showorg',
          result.addedOrg.organizationId,
          cookieOptions
        );
      }
      return response.redirect(
        303,
        `${this.frontend()}/${result.isNew ? 'launches?onboarding=true' : ''}`
      );
    } catch (error) {
      // Do not leak provider responses, secrets, tokens or database details.
      return this.fail(
        response,
        (error as Error).message === 'Registration is disabled'
          ? 'registration_disabled'
          : 'login_failed'
      );
    }
  }
}
