import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function RegisterPage() {
  const { registerWithEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleRegister(event) {
    event.preventDefault()
    setError('')
    setSent(false)
    setIsSubmitting(true)
    try {
      await registerWithEmail(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-shell min-h-screen px-4 py-8">
      <div className="mx-auto mt-4 flex w-full max-w-md items-center justify-center gap-3">
        <img src="/logo.png" alt="SecLens Logo" className="h-12 w-auto rounded-[10px]" />
        <p className="text-2xl font-semibold tracking-tight text-[#dee3ea]">SecLens</p>
      </div>
      <div className="auth-card mx-auto mt-8 w-full max-w-md p-6">
        <h1 className="auth-title">Register</h1>
        <p className="auth-subtitle mt-2 text-sm">
          Enter customer email. We will send a password reset email so they can set their password securely.
        </p>
        <form className="mt-5 space-y-3" onSubmit={handleRegister}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            className="auth-input w-full px-3 py-2.5"
            required
          />
          <button type="submit" className="auth-primary-button h-10 w-full justify-center" disabled={isSubmitting}>
            Create account and send reset email
          </button>
        </form>
        {error ? <p className="seclens-danger mt-3 rounded-md px-3 py-2 text-sm">{error}</p> : null}
        {sent ? (
          <p className="mt-3 rounded-md bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200">
            Account ready. Password setup email sent to {email}.
          </p>
        ) : null}
        <p className="mt-4 text-sm">
          <Link to="/login" className="auth-link">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
