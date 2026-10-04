import { ReactNode, Suspense } from 'react';
import { AuthLayoutSwitch } from '@gitroom/frontend/components/auth/modern/auth-layout-switch';
export const dynamic = 'force-dynamic';
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <AuthLayoutSwitch>{children}</AuthLayoutSwitch>
    </Suspense>
  );
}
