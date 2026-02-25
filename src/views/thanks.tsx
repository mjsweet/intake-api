import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { Brand } from "../lib/brands";

interface ThanksProps {
  projectName: string;
  brand: Brand;
}

export const ThanksPage: FC<ThanksProps> = ({ projectName, brand }) => (
  <Layout title={`Thank You - ${brand.name}`} brand={brand}>
    <div class="text-center py-16">
      <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg
          class="w-8 h-8 text-green-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
      <h1 class="text-2xl font-bold text-gray-900 mb-3">
        Thank you for completing the intake form
      </h1>
      <p class="text-gray-600 mb-6 max-w-md mx-auto">
        We have received your information for the{" "}
        <strong>{projectName}</strong> project. Our team will review your
        submission and be in touch shortly.
      </p>
      <div class="bg-gray-100 rounded-lg p-6 max-w-md mx-auto text-left">
        <h2 class="font-semibold text-gray-900 mb-3">What happens next</h2>
        <ol class="space-y-2 text-sm text-gray-600">
          <li class="flex gap-2">
            <span class="font-semibold text-gray-900">1.</span>
            We review your submission and uploaded assets
          </li>
          <li class="flex gap-2">
            <span class="font-semibold text-gray-900">2.</span>
            We may follow up with clarifying questions
          </li>
          <li class="flex gap-2">
            <span class="font-semibold text-gray-900">3.</span>
            Your project brief is compiled and work begins
          </li>
        </ol>
      </div>
    </div>
  </Layout>
);
