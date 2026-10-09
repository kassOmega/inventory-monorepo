"use client";

// Route-level error boundary for the reports pages. Without this a component
// error bubbles to Next's global error screen ("This page couldn't load"); with
// it the user gets a recoverable message and the real error is logged to the
// browser console for debugging.
import { useEffect } from "react";

export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real error in the browser console for debugging.
    console.error("[reports] route error:", error);
  }, [error]);

  return (
    <div className="p-6">
      <div className="max-w-lg mx-auto bg-white border border-red-200 rounded-xl p-6 text-center space-y-3">
        <h2 className="text-lg font-bold text-gray-800">
          Something went wrong on this report
        </h2>
        <p className="text-sm text-gray-500 break-words">
          {error?.message || "An unexpected error occurred."}
        </p>
        <div className="flex justify-center gap-2">
          <button
            onClick={() => reset()}
            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="border border-gray-300 text-gray-700 rounded px-4 py-2 text-sm font-medium"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
