import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The shared design system first (tokens for both themes, Inter, base and component
// styles), then Crane Charts' own layout, on the same tokens.
import '@hhh/ui/tokens.css';
import '@hhh/ui/base.css';
import '@hhh/ui/components.css';
import { ToastProvider } from '@hhh/ui';
import './styles/index.css';
import { App } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>
);
