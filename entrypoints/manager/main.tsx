import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../src/ui/base.css';
import './manager.css';
import { ManagerApp } from './ManagerApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ManagerApp />
  </React.StrictMode>,
);
