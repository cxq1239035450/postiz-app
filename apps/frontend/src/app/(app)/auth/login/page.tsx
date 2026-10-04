export const dynamic = 'force-dynamic';
import { ModernAuthPage } from '@gitroom/frontend/components/auth/modern/auth-page';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: '登录 — QPublish',
  description: '',
};
export default async function Auth() {
  return <ModernAuthPage />;
}
