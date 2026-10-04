import { randomBytes, timingSafeEqual } from 'crypto';
import { sign, verify } from 'jsonwebtoken';
import type { WebLoginProviderId } from '@gitroom/helpers/auth/web-login.config';
import type { LoginTransaction } from './web-login.provider';

const audience = 'qpublish-web-login';
export const LOGIN_TRANSACTION_SECONDS = 600;

export function createLoginTransaction(provider: WebLoginProviderId) {
  const transaction: LoginTransaction = {
    provider,
    state: randomBytes(24).toString('hex'),
    nonce: randomBytes(24).toString('hex'),
    verifier: randomBytes(48).toString('base64url'),
  };
  const cookie = sign(transaction, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    audience,
    expiresIn: LOGIN_TRANSACTION_SECONDS,
  });
  return { transaction, cookie };
}

export function verifyLoginTransaction(
  provider: string,
  state: unknown,
  cookie: unknown
) {
  if (
    typeof cookie !== 'string' ||
    typeof state !== 'string' ||
    !/^[a-f0-9]{48}$/.test(state)
  ) {
    throw new Error('Invalid login state');
  }
  const transaction = verify(cookie, process.env.JWT_SECRET!, {
    algorithms: ['HS256'],
    audience,
  }) as LoginTransaction;
  if (
    transaction.provider !== provider ||
    typeof transaction.state !== 'string' ||
    transaction.state.length !== state.length ||
    !timingSafeEqual(Buffer.from(transaction.state), Buffer.from(state))
  ) {
    throw new Error('Invalid login state');
  }
  return transaction;
}
