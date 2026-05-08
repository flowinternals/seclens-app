import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ResetPasswordPage() {
  const { sendResetEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleReset(event) {
    event.preventDefault()
    setError('')
    setSent(false)
    setIsSubmitting(true)
    try {
      await sendResetEmail(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
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
        <h1 className="auth-title">Reset password</h1>
        <p className="auth-subtitle mt-2 text-sm">Send a reset email for your account.</p>
        <form className="mt-5 space-y-3" onSubmit={handleReset}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            className="auth-input w-full px-3 py-2.5"
            required
          />
          <button type="submit" className="auth-primary-button h-10 w-full justify-center" disabled={isSubmitting}>
            Send reset email
          </button>
        </form>
        {error ? <p className="seclens-danger mt-3 rounded-md px-3 py-2 text-sm">{error}</p> : null}
        {sent ? (
          <p className="mt-3 rounded-md bg-emerald-500/15 px-3 py-2 text-sm text-emerald-200">Reset email sent.</p>
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
