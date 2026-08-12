import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import styles from './Login.module.css'

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err.message || 'Erro ao fazer login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>▲</span>
          <span className={styles.logoText}>Altezza</span>
        </div>
        <p className={styles.subtitle}>Dashboard Executivo</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              className={styles.input}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              autoComplete="email"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              className={styles.input}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
