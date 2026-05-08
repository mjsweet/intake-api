import type { FC, PropsWithChildren } from "hono/jsx";
import type { Brand } from "../lib/brands";

interface LayoutProps {
  title?: string;
  brand?: Brand;
}

const defaultBrand: Brand = {
  name: "Platform21",
  tagline: "Secure Client Intake",
  footer: "Platform21 &middot; South East Queensland",
  primaryColour: "#1e3a5f",
  titleSuffix: "Platform21",
};

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title = "Secure Client Intake - Platform21",
  brand = defaultBrand,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .field-scraped {
          border-color: #3b82f6;
          border-width: 2px;
        }
        .step-hidden { display: none; }
        .progress-filled { background-color: ${brand.primaryColour}; }
        .progress-empty { background-color: #e5e7eb; }
        .drag-over { border-color: #3b82f6; background-color: #eff6ff; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .annotation-layer { position: absolute; inset: 0; cursor: crosshair; user-select: none; -webkit-user-select: none; }
        .annotation-pin {
          position: absolute; width: 24px; height: 24px; border-radius: 50%;
          color: white; font-size: 12px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          transform: translate(-50%, -50%); cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3); z-index: 10;
          transition: transform 0.1s ease;
        }
        .annotation-pin:hover { transform: translate(-50%, -50%) scale(1.15); }
        .annotation-note { display: flex; align-items: start; gap: 8px; }
        .annotation-note-pin {
          flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
          color: white; font-size: 10px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          margin-top: 6px;
        }
        .crop-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; padding: 16px; }
        .crop-modal { background: white; border-radius: 12px; max-width: 600px; width: 100%; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; }
        .crop-modal-body { flex: 1; overflow: hidden; padding: 16px; min-height: 0; }
        .crop-modal-body img { max-width: 100%; display: block; }
        .crop-modal-footer { padding: 12px 16px; border-top: 1px solid #e5e7eb; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
        .crop-ratios { display: flex; gap: 4px; flex-wrap: wrap; }
        .crop-ratio-btn { padding: 4px 10px; border-radius: 6px; font-size: 13px; border: 1px solid #d1d5db; background: white; cursor: pointer; }
        .crop-ratio-btn.active { background: #1e3a5f; color: white; border-color: #1e3a5f; }
        .crop-actions { display: flex; gap: 8px; }
        .crop-round-preview .cropper-view-box, .crop-round-preview .cropper-face { border-radius: 50%; }
      `,
        }}
      />
    </head>
    <body class="bg-gray-50 min-h-screen">
      <header class="bg-white border-b border-gray-200 px-4 py-3">
        <div class="max-w-2xl mx-auto flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="font-bold text-xl text-gray-900">{brand.name}</div>
            <span class="text-gray-400">|</span>
            <span class="text-sm text-gray-500">{brand.tagline}</span>
          </div>
          <div class="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>Encrypted</span>
          </div>
        </div>
      </header>
      <main class="max-w-2xl mx-auto px-4 py-8">{children}</main>
      <footer
        class="border-t border-gray-200 mt-16 py-6 text-center text-sm text-gray-400"
        dangerouslySetInnerHTML={{ __html: brand.footer }}
      />
    </body>
  </html>
);
