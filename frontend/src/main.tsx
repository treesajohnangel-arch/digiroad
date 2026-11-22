import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{AppStateProvider}from'./state';import App from'./ui';import'leaflet/dist/leaflet.css';import'./style.css';import'./idex.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><AppStateProvider><App/></AppStateProvider></BrowserRouter></React.StrictMode>);
// Offline shell for field use (public/sw.js). Production only, so dev reloads are never stale.
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
