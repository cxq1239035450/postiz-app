import { Injectable } from '@nestjs/common';
import { OAuth2Client, CodeChallengeMethod } from 'google-auth-library';
import { createHash } from 'crypto';
import { webLoginConfig } from '@gitroom/helpers/auth/web-login.config';
import { LoginTransaction, WebLoginProvider } from './web-login.provider';

@Injectable()
export class GoogleLoginProvider implements WebLoginProvider {
  readonly id = 'google';

  private client() {
    const config = webLoginConfig(this.id);
    return new OAuth2Client(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );
  }

  authorizationUrl(transaction: LoginTransaction) {
    return this.client().generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: createHash('sha256')
        .update(transaction.verifier)
        .digest('base64url'),
      code_challenge_method: CodeChallengeMethod.S256,
      prompt: 'select_account',
    });
  }

  async exchange(code: string, transaction: LoginTransaction) {
    const client = this.client();
    const { tokens } = await client.getToken({
      code,
      codeVerifier: transaction.verifier,
    });
    if (!tokens.id_token) throw new Error('Missing Google identity');
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: webLoginConfig(this.id).clientId,
    });
    const identity = ticket.getPayload();
    if (
      !identity?.sub ||
      !identity.email ||
      !identity.email_verified ||
      (identity as typeof identity & { nonce?: string }).nonce !==
        transaction.nonce
    ) {
      throw new Error('Invalid Google identity');
    }
    return {
      id: identity.sub,
      email: identity.email.toLowerCase(),
      name: identity.name,
    };
  }
}
