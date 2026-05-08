import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SplitBilled from './SplitBilled.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SplitBilled />
  </StrictMode>,
)
