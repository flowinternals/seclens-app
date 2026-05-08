import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6382-.0573-1.2518-.1636-1.8409H9v3.4818h4.8436a4.1394 4.1394 0 0 1-1.7955 2.7177v2.2582h2.9082c1.7018-1.5668 2.6837-3.8741 2.6837-6.6168z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.8068 5.9563-2.1782l-2.9082-2.2582c-.8068.5409-1.8409.8605-3.0481.8605-2.3441 0-4.3281-1.5832-5.0372-3.7091H.9573v2.3327A8.9999 8.9999 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.9628 10.715c-.1801-.5409-.2837-1.1182-.2837-1.715s.1036-1.1741.2837-1.715V4.9523H.9573A8.9999 8.9999 0 0 0 0 9c0 1.4523.3482 2.8277.9573 4.0477l3.0055-2.3327z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5759c1.3214 0 2.5077.4541 3.4418 1.3454l2.5828-2.5827C13.4636.8918 11.4263 0 9 0A8.9999 8.9999 0 0 0 .9573 4.9523L3.9628 7.285c.7091-2.126 2.6931-3.7091 5.0372-3.7091z"
      />
    </svg>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, signInWithEmail, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const redirectTo = location.state?.from || '/'

  useEffect(() => {
    if (isAuthenticated) {
      navigate(redirectTo, { replace: true })
    }
  }, [isAuthenticated, navigate, redirectTo])

  async function handleEmailLogin(event) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await signInWithEmail(email, password)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleGoogleLogin() {
    setError('')
    setIsSubmitting(true)
    try {
      await signInWithGoogle()
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign in failed')
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
        <button
          type="button"
          className="google-button mt-6"
          onClick={handleGoogleLogin}
          disabled={isSubmitting}
          aria-label="Sign in with Google"
        >
          <GoogleGlyph />
          <span>Sign in with Google</span>
        </button>

        <div className="auth-divider my-5 text-xs uppercase tracking-[0.08em]">or use email</div>

        <form className="space-y-3" onSubmit={handleEmailLogin}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            className="auth-input w-full px-3 py-2.5"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className="auth-input w-full px-3 py-2.5"
            required
          />
          <button type="submit" className="auth-primary-button h-10 w-full justify-center" disabled={isSubmitting}>
            Sign in
          </button>
        </form>

        {error ? <p className="seclens-danger mt-4 rounded-md px-3 py-2 text-sm">{error}</p> : null}

        <div className="mt-5 flex items-center justify-between text-sm">
          <Link to="/register" className="auth-link">
            Register
          </Link>
          <Link to="/reset-password" className="auth-link">
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  )
}
