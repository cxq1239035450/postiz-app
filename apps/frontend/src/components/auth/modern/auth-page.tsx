import { publicWebLoginConfig } from '@gitroom/helpers/auth/web-login.config';
import { AuthScreen } from './auth-screen';

export function ModernAuthPage({
  mode = 'login',
}: {
  mode?: 'login' | 'register';
}) {
  const website = (
    process.env.QPUBLISH_WEBSITE_URL || 'https://home.qpublush.io'
  ).replace(/\/$/, '');
  return (
    <AuthScreen
      key={mode}
      mode={mode}
      providers={publicWebLoginConfig()}
      allowRegistration={process.env.DISABLE_REGISTRATION !== 'true'}
      termsUrl={`${website}/terms`}
      privacyUrl={`${website}/privacy`}
    />
  );
}
