import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AppProviders } from './app/providers'
import { router } from './app/router'
import '@fontsource-variable/roboto/index.css'
import './styles/tokens.css'
import './styles/global.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/pages.css'

const root = document.getElementById('root')
if (!root) throw new Error('BERT CRM root element is missing')

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
