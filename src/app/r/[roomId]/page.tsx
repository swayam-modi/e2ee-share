import type { Metadata } from 'next';
import { ReceiverView } from '@/components/receiver-view';

export const metadata: Metadata = {
  title: 'Receive Files Securely — E2EE Share',
};

export default async function ReceiverPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  // roomId is safe server-side — it's from the URL path, not the fragment.
  // The #fragment secret is ONLY read client-side inside ReceiverView.
  return <ReceiverView roomId={roomId} />;
}
