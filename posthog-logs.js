const { OTLPLogExporter } = require("@opentelemetry/exporter-logs-otlp-http");
const { resourceFromAttributes } = require("@opentelemetry/resources");
const { BatchLogRecordProcessor, LoggerProvider } = require("@opentelemetry/sdk-logs");

let loggerProvider;
let logger;

const getConfiguredValue = (name) => (process.env[name] || "").trim();

const warnForMissingConfiguration = (name) => {
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `${name} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${name} is configured`
    );
  }
};

const createPostHogLogger = () => {
  const projectToken = getConfiguredValue("POSTHOG_PROJECT_TOKEN");
  const host = getConfiguredValue("POSTHOG_HOST");

  if (!projectToken) {
    warnForMissingConfiguration("POSTHOG_PROJECT_TOKEN");
    return null;
  }

  if (!host) {
    warnForMissingConfiguration("POSTHOG_HOST");
    return null;
  }

  const exporter = new OTLPLogExporter({
    url: `${host.replace(/\/$/, "")}/i/v1/logs`,
    headers: { Authorization: `Bearer ${projectToken}` },
    timeoutMillis: 1000,
  });

  loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({ "service.name": "mowarson-portfolio" }),
    processors: [
      new BatchLogRecordProcessor(exporter, { exportTimeoutMillis: 1000 }),
    ],
  });

  return loggerProvider.getLogger("posthog-exporter");
};

const emit = (severityText, body, attributes) => {
  try {
    logger?.emit({ severityText, body, attributes });
  } catch {
    // Log export must never affect the request being handled.
  }
};

logger = createPostHogLogger();

const posthogLogger = {
  info: (body, attributes = {}) => emit("info", body, attributes),
};

const flushPostHogLogs = async () => {
  if (loggerProvider) {
    try {
      await loggerProvider.forceFlush();
    } catch {
      // Log delivery must not fail a serverless request.
    }
  }
};

const shutdownPostHogLogs = async () => {
  if (loggerProvider) {
    try {
      await loggerProvider.shutdown();
    } catch {
      // Keep shutdown resilient if log delivery is unavailable.
    }
  }
};

module.exports = { flushPostHogLogs, posthogLogger, shutdownPostHogLogs };
