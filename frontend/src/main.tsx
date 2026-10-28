import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// 渲染前应用上次的主题，避免设置加载前的闪色
if (localStorage.getItem('postlite-theme') === 'light') {
  document.documentElement.dataset.theme = 'light'
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
