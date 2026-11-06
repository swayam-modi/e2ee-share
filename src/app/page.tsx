import type { Metadata } from 'next';
import { SenderView } from '@/components/sender-view';

export const metadata: Metadata = {
  title: 'Send Files Securely — E2EE Share',
};

export default function SenderPage() {
  return <SenderView />;
}
