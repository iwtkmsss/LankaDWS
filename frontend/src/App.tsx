import { useEffect, useState } from 'react'
import './App.css'

type HealthResponse = {
  name: string
  status: string
  timestamp: string
  uptime: number
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api'

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    fetch(`${apiBaseUrl}/health`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`)
        }

        return response.json() as Promise<HealthResponse>
      })
      .then((data) => {
        if (isMounted) {
          setHealth(data)
        }
      })
      .catch((fetchError: unknown) => {
        if (isMounted) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : 'Unable to reach API',
          )
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  const apiStatus = isLoading ? 'Checking' : health ? 'Connected' : 'Offline'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">BertCRM</span>
          <h1>Development workspace</h1>
        </div>
        <div className={`status-pill status-${health ? 'ok' : 'pending'}`}>
          {apiStatus}
        </div>
      </header>

      <section className="overview-grid">
        <article className="panel panel-large">
          <span className="panel-label">Frontend</span>
          <h2>React + Vite + TypeScript</h2>
          <p>
            The client app is ready for component development, fast refresh,
            and API calls through the local Vite proxy.
          </p>
          <div className="command-row">
            <code>npm run dev:frontend</code>
            <code>http://localhost:5173</code>
          </div>
        </article>

        <article className="panel">
          <span className="panel-label">Backend</span>
          <h2>NestJS API</h2>
          <p>Global API prefix is configured as <code>/api</code>.</p>
          <code>npm run dev:backend</code>
        </article>

        <article className="panel">
          <span className="panel-label">Health check</span>
          <h2>{apiStatus}</h2>
          {health ? (
            <p>
              {health.name} responded at{' '}
              {new Date(health.timestamp).toLocaleTimeString()}.
            </p>
          ) : (
            <p>{error ?? 'Waiting for the backend health endpoint.'}</p>
          )}
        </article>
      </section>

      <section className="next-steps">
        <div>
          <span className="panel-label">Next</span>
          <h2>Build CRM modules from here</h2>
          <p>
            Add authentication, customer records, deals, tasks, and reporting as
            dedicated frontend pages and Nest modules.
          </p>
        </div>
      </section>
    </main>
  )
}

export default App
