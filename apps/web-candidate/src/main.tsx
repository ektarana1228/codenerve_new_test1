import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import '@platform/web-shared/src/theme.css'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry failed requests twice before surfacing the error to the component
      retry: 2,
      // Data is considered fresh for 30 seconds; avoids redundant background fetches
      staleTime: 30_000,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
