import { Register } from '@gitroom/frontend/components/auth/register';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export const metadata = { title: '旧版注册 — QPublish' };
export default async function LegacyRegisterPage() {
  if (process.env.DISABLE_REGISTRATION === 'true') {
    const { register } = await (
      await internalFetch('/auth/can-register')
    ).json();
    if (!register) redirect('/auth/legacy/login');
  }
  return <Register />;
}
