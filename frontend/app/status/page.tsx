import { promises as fs } from "fs";
import path from "path";

// The startup status is written at runtime by the container entrypoint, so the
// page must be evaluated per request (never prerendered at build time).
export const dynamic = "force-dynamic";

interface StartupStatus {
  stage?: string;
  ok?: boolean;
  error?: string;
  time?: string;
}

function candidateStatusFiles(): string[] {
  const files: string[] = [];
  if (process.env.STATUS_FILE) files.push(process.env.STATUS_FILE);
  files.push(path.join(process.cwd(), "public", "startup.json"));
  files.push("/app/frontend/public/startup.json");
  return files;
}

async function loadStatus(): Promise<StartupStatus | null> {
  for (const file of candidateStatusFiles()) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const data = JSON.parse(raw) as StartupStatus;
      if (data && typeof data === "object") return data;
    } catch {
      // try the next candidate path
    }
  }
  return null;
}

function hintsFor(status: StartupStatus | null): string[] {
  if (!status || status.ok !== false) {
    return ["All startup stages completed successfully. No action needed."];
  }
  const error = status.error ?? "";
  const hints: string[] = [];
  if (/JWT_SECRET/i.test(error)) {
    hints.push(
      "Set JWT_SECRET to a strong random value of at least 64 characters (e.g. openssl rand -hex 64).",
    );
  }
  if (/DATABASE_URL/i.test(error)) {
    hints.push(
      "Check DATABASE_URL: it must be set and reachable from the container.",
    );
  }
  if (/migrate deploy|db push|migration|schema/i.test(error)) {
    hints.push(
      "Apply the schema manually, e.g. docker exec <container> npx --no-install prisma db push, then redeploy.",
    );
  }
  if (hints.length === 0) {
    hints.push(
      "Fix the reported error and redeploy. No container log access is required.",
    );
  }
  return hints;
}

export default async function StatusPage() {
  const status = await loadStatus();
  const ok = status ? status.ok !== false : true;
  const stage = status?.stage ?? "unknown";
  const error = status?.error ?? "";
  const time = status?.time ?? "";
  const hints = hintsFor(status);

  return (
    <main
      data-startup-ok={ok ? "true" : "false"}
      className="min-h-screen bg-gray-100 px-6 py-12 text-gray-900"
    >
      <div className="mx-auto max-w-2xl rounded-xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Startup status</h1>
        <p className="mt-2 text-lg">
          Status:{" "}
          <span
            className={
              ok ? "font-semibold text-green-700" : "font-semibold text-red-700"
            }
          >
            {ok ? "Healthy" : "Degraded"}
          </span>
        </p>

        {stage && (
          <p className="mt-1 text-sm text-gray-600">Stage: {stage}</p>
        )}

        {!ok && (
          <section className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <h2 className="font-semibold text-red-800">
              Startup failed at: {stage}
            </h2>
            <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-red-900">
              {error || "Unknown error"}
            </pre>
          </section>
        )}

        <section className="mt-6">
          <h2 className="text-lg font-semibold">What to do</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </section>

        <p className="mt-6 text-xs text-gray-500">
          {time
            ? `Last update: ${time}`
            : "No status file found — the service has not reported yet."}
        </p>
      </div>
    </main>
  );
}
