import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{AppStateProvider}from'./state';import App from'./ui';import'leaflet/dist/leaflet.css';import'./style.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><AppStateProvider><App/></AppStateProvider></BrowserRouter></React.StrictMode>);
