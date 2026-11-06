import React from 'react';
import { SenderPage } from './pages/SenderPage.js';
import { ReceiverPage } from './pages/ReceiverPage.js';

export const App: React.FC = () => {
  const isReceiver = window.location.pathname.startsWith('/r/');

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        minHeight: '100dvh',
      }}
    >
      {isReceiver ? <ReceiverPage /> : <SenderPage />}
    </main>
  );
};
