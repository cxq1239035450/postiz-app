import type { WebLoginProviderId } from '@gitroom/helpers/auth/web-login.config';

export type LoginTransaction = {
  provider: WebLoginProviderId;
  state: string;
  nonce: string;
  verifier: string;
};

export type VerifiedLoginIdentity = {
  id: string;
  email?: string;
  name?: string;
};

export interface WebLoginProvider {
  readonly id: WebLoginProviderId;
  authorizationUrl(transaction: LoginTransaction): string;
  exchange(
    code: string,
    transaction: LoginTransaction
  ): Promise<VerifiedLoginIdentity>;
}
