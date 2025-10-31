function PrivacyPolicy() {
  return (
    <div>
      <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Privacy Policy</h3>
      <div className="space-y-4 text-gray-700 dark:text-gray-300">
        <p>
          <strong>Last Updated:</strong> October 31, 2025
        </p>
        
        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Information We Collect</h4>
          <p>
            SecLens is designed with privacy in mind. We do not collect, store, or process any personal information from users. 
            When you use SecLens to analyze a GitHub repository:
          </p>
          <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
            <li>We do not require account creation or login</li>
            <li>We do not store your repository URLs or analysis results</li>
            <li>We do not use cookies for tracking purposes</li>
            <li>We do not collect any personal data</li>
          </ul>
        </section>

        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">How We Process Data</h4>
          <p>
            When you submit a GitHub repository URL for analysis:
          </p>
          <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
            <li>The repository URL is sent to our serverless functions for analysis</li>
            <li>Analysis is performed using OpenAI's API</li>
            <li>Results are returned to your browser and displayed on your screen</li>
            <li>No data is stored on our servers after the analysis completes</li>
          </ul>
        </section>

        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Third-Party Services</h4>
          <p>
            SecLens uses the following third-party services:
          </p>
          <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
            <li><strong>Vercel:</strong> Hosting and serverless functions</li>
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
            We implement comprehensive security measures to protect any data processed during analysis:
          </p>
          <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
            <li>All API communications use HTTPS encryption</li>
            <li>Input sanitization prevents injection attacks</li>
            <li>Rate limiting prevents abuse</li>
            <li>No persistent storage of analysis results</li>
          </ul>
        </section>

        <section>
          <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">Your Rights</h4>
          <p>
            Since we do not collect or store personal information, there is no personal data to access, modify, or delete. 
            However, if you have any concerns about your privacy while using SecLens, please contact us.
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

