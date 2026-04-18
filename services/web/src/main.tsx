import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, theme } from 'antd';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';

const queryClient = new QueryClient();

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: '#5B5BD6',
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            borderRadius: 8,
            colorBgLayout: '#F7F8FA',
            colorBgContainer: '#FFFFFF',
            colorBorder: '#E4E7EC',
            colorBorderSecondary: '#F0F2F5',
            fontSize: 14,
            lineHeight: 1.5,
          },
          components: {
            Button: {
              borderRadius: 8,
              controlHeight: 36,
            },
            Input: {
              borderRadius: 8,
              controlHeight: 36,
            },
            Select: {
              borderRadius: 8,
              controlHeight: 36,
            },
            Card: {
              borderRadius: 10,
            },
            Modal: {
              borderRadius: 12,
            },
          },
        }}
      >
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ConfigProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
