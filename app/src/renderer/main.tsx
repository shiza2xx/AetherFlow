import {UpdateNotifications} from './UpdateNotifications';
import {SharedTooltips} from './SharedTooltips';
import '@fontsource-variable/manrope';import React from 'react';import{createRoot}from'react-dom/client';import App from './App';import './styles.css';import './production.css';import './glass-system.css';import './ui-fix-pack.css';import './visual-polish.css';createRoot(document.getElementById('root')!).render(<React.StrictMode><App/><UpdateNotifications/><SharedTooltips/></React.StrictMode>);
