import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { Register } from '@gitroom/frontend/components/auth/register';
import { ModernAuthPage } from '@gitroom/frontend/components/auth/modern/auth-page';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export const metadata = { title: '创建账号 — QPublish' };
export default async function Auth({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>;
}) {
  const { provider } = await searchParams;
  if (provider) return <Register />;
  if (process.env.DISABLE_REGISTRATION === 'true') {
    const { register } = await (
      await internalFetch('/auth/can-register')
    ).json();
    if (!register) redirect('/auth/login');
  }
  return <ModernAuthPage mode="register" />;
}
