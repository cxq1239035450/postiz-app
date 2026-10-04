'use client';
import { ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import LegacyAuthLayout from '../legacy/layout';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Toaster } from '@gitroom/react/toaster/toaster';
import ReturnUrlComponent from '@gitroom/frontend/app/(app)/auth/return.url.component';

export function AuthLayoutSwitch({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const query = useSearchParams();
  const modern =
    (pathname === '/auth' || pathname === '/auth/login') &&
    !query.get('provider');
  if (!modern) return <LegacyAuthLayout>{children}</LegacyAuthLayout>;
  return (
    <MantineWrapper>
      <Toaster />
      <ReturnUrlComponent />
      {children}
    </MantineWrapper>
  );
}
