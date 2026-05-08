function PrivacyPolicy() {
  return (
    <div>
      <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Privacy Policy</h3>
      <div className="space-y-4 text-gray-700 dark:text-gray-300">
        <p>
          <strong>Last Updated:</strong> May 2, 2026
        </p>

        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Information We Collect</h4>
          <p>
            SecLens collects only the information required to operate the advisory service, secure access, and support admin
            diagnostics.
          </p>
          <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
            <li>Account details via Firebase Auth (for example email, display name, and UID)</li>
            <li>Repository metadata submitted for runs (for example repository URL, branch, and commit where available)</li>
            <li>Run telemetry needed for reliability and troubleshooting (status, reason codes, warnings, errors, and usage metrics)</li>
            <li>Basic security and abuse-control signals such as request/rate-limit events</li>
          </ul>
        </section>

        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">How We Process Data</h4>
          <p>
            When you submit a repository for review:
          </p>
          <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
            <li>Selected repository data is processed by SecLens serverless services</li>
            <li>Analysis is performed using supported AI providers (including OpenAI where configured)</li>
            <li>Run-level telemetry is persisted so run outcomes can be audited and diagnosed</li>
            <li>Admin-only diagnostic views are restricted using role-based access controls</li>
          </ul>
        </section>

        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Third-Party Services</h4>
          <p>
            SecLens uses the following third-party services:
          </p>
          <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
            <li><strong>Vercel:</strong> Hosting and serverless functions</li>
            <li><strong>Firebase:</strong> Authentication, role management support, and data storage</li>
            <li><strong>OpenAI:</strong> Security analysis processing</li>
            <li><strong>Google reCAPTCHA:</strong> Bot protection</li>
          </ul>
          <p className="mt-2">
            Please review their respective privacy policies for information about how they handle data.
          </p>
        </section>

        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Data Security</h4>
          <p>
            We implement controls to protect data used by the service:
          </p>
          <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
            <li>All API communications use HTTPS encryption</li>
            <li>Input validation and sanitization protections are applied</li>
            <li>Rate limiting and abuse controls are enforced</li>
            <li>Role-based access controls restrict admin diagnostics</li>
            <li>Access to telemetry and account-linked data follows least-privilege principles</li>
          </ul>
        </section>

        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Retention and Access</h4>
          <p>
            Account profile records and run telemetry are retained for product operation, diagnostics, and security auditing.
            Access to admin telemetry is restricted to authorized admin users. Non-admin users are limited to user-safe views.
          </p>
        </section>

        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Product Scope Disclaimer</h4>
          <p>
            SecLens is a repository security advisory tool. It does not prove the presence or absence of vulnerabilities.
            Recommendations, prompts, and suggested tests are based on selected repository files and should be reviewed by a
            developer or security engineer before changes are made.
          </p>
        </section>

        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Changes to This Policy</h4>
          <p>
            We may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated revision date.
          </p>
        </section>

        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Contact Us</h4>
          <p>
            If you have questions about this Privacy Policy, please contact us through our GitHub repository.
          </p>
        </section>
      </div>
    </div>
  )
}

export default PrivacyPolicy

