import React from 'react';
import { CORE_VERSION } from '@e2ee-share/core';

export const App: React.FC = () => {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>E2EE P2P File Sharing</h1>
      <p>End-to-end encrypted direct browser-to-browser file transfer.</p>
      <p>Core protocol version: {CORE_VERSION}</p>
    </main>
  );
};
