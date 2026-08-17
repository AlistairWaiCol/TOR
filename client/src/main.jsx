import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProvider } from './state/AppContext.jsx';
import { RollProvider } from './components/RollDialog.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <RollProvider>
          <App />
        </RollProvider>
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
