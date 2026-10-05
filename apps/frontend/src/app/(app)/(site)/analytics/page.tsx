export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { AnalyticsWithWebsites } from '@gitroom/frontend/components/website-analytics/website-analytics';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Analytics`,
  description: '',
};
export default async function Index() {
  return <AnalyticsWithWebsites />;
}
