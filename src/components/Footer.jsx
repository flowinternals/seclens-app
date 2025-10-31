import Modal from './Modal'

function Footer({ onOpenPrivacy, onOpenTerms }) {
  return (
    <footer className="border-t border-gray-700/50 backdrop-blur-md mt-auto" style={{ backgroundColor: '#101012' }}>
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-gray-300">
          <span className="text-gray-400">© 2025 Sagesilver Pty Ltd</span>
          <span className="text-gray-600">|</span>
          <button
            onClick={onOpenPrivacy}
            className="hover:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-800 rounded px-2 py-1 transition-colors"
            aria-label="Open Privacy Policy"
          >
            Privacy Policy
          </button>
          <span className="text-gray-600">|</span>
          <button
            onClick={onOpenTerms}
            className="hover:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-800 rounded px-2 py-1 transition-colors"
            aria-label="Open Terms and Conditions"
          >
            Terms & Conditions
          </button>
        </div>
      </div>
    </footer>
  )
}

export default Footer

