import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme.ts'
import App from './App.tsx'
import { Tooltips } from './components/Tooltips.tsx'
import { FolderMissing } from './components/FolderMissing.tsx'
import { keepServerAlive } from './autoExit.ts'
import { folderMissing, initStorage, viewLastCopy } from './db.ts'

// Started from molanote.cmd: let the local server stop once the last tab closes.
if (import.meta.env.VITE_BOARD_AUTO_EXIT === '1') keepServerAlive()

/** The boards, or (when the data folder cannot be reached) the screen that says so. */
function Root() {
  const [missing, setMissing] = useState(folderMissing)
  if (missing)
    return (
      <FolderMissing
        dir={missing.dir}
        onViewLastCopy={() => {
          viewLastCopy(missing.dir)
          setMissing(null)
        }}
      />
    )
  return <App />
}

// The data folder (or the browser's storage) is chosen before anything is loaded.
initStorage().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
      {/* Black hover bubbles everywhere. */}
      <Tooltips />
    </StrictMode>,
  ),
)
