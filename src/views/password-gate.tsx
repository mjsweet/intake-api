import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import type { Brand } from "../lib/brands";

interface PasswordGateProps {
  token: string;
  error?: boolean;
  brand: Brand;
}

export const PasswordGatePage: FC<PasswordGateProps> = ({ token, error, brand }) => (
  <Layout title={`Access Form - ${brand.name}`} brand={brand}>
    <div class="max-w-sm mx-auto py-12">
      <div class="text-center mb-8">
        <div class="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            class="w-7 h-7 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
        </div>
        <h1 class="text-xl font-bold text-gray-900 mb-2">
          Enter the password to access this form
        </h1>
        <p class="text-sm text-gray-500">
          Check the email you received for the access password.
        </p>
      </div>

      {error && (
        <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
          Incorrect password. Please try again.
        </div>
      )}

      <form method="POST" action={`/${token}/verify`}>
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <input
            type="password"
            name="password"
            required
            autofocus
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter access password"
          />
        </div>
        <button
          type="submit"
          class="w-full px-4 py-2 text-sm font-medium text-white rounded-lg"
          style={`background-color: ${brand.primaryColour};`}
        >
          Continue
        </button>
      </form>
    </div>
  </Layout>
);
