import { render } from 'preact';
import './styles.css';
import { App } from './App';

if (
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  window.location.protocol.startsWith('http')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline SW registration is optional in dev/preview environments.
    });
  });
}

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
