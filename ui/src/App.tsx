import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import { Home } from './pages/Home.tsx'
import { CasePage } from './pages/CasePage.tsx'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-4">
            <Link to="/" className="hover:opacity-80 transition-opacity">
              <h1 className="text-2xl font-serif font-bold tracking-tight">
                Consulting Detective
              </h1>
              <p className="text-sm text-stone-500">A daily mystery to solve</p>
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/case/:caseDate" element={<CasePage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
