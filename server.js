require("dotenv").config();
const express = require("express");
const path = require("path");
const { posthogLogger, shutdownPostHogLogs } = require("./posthog-logs");
const { execFileSync } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

try {
  execFileSync(process.execPath, [path.join(__dirname, "scripts", "generate-seo.mjs")], {
    cwd: __dirname,
    stdio: "inherit"
  });
} catch (error) {
  console.error("Unable to generate sitemap and JSON-LD:", error.message);
}

app.get("/sitemap.xml", (req, res) => {
  try {
    execFileSync(process.execPath, [path.join(__dirname, "scripts", "generate-seo.mjs")], {
      cwd: __dirname,
      stdio: "inherit"
    });
  } catch (error) {
    console.error("Unable to refresh sitemap and JSON-LD:", error.message);
  }
  res.type("application/xml").sendFile(path.join(__dirname, "sitemap.xml"));
});

// Serve static assets from project root
app.use(express.static(path.join(__dirname)));

const functionHandlers = {
  "/api/config": require("./netlify/functions/config").handler,
  "/api/contact": require("./netlify/functions/contact").handler,
  "/api/quote": require("./netlify/functions/quote").handler,
  "/api/create-order": require("./netlify/functions/create-order").handler,
  "/api/verify-payment": require("./netlify/functions/verify-payment").handler,
};

const invokeFunction = async (handler, req, res) => {
  const contentType = req.headers["content-type"] || "";
  const body = contentType.includes("application/json")
    ? JSON.stringify(req.body || {})
    : new URLSearchParams(req.body || {}).toString();
  const queryIndex = req.originalUrl.indexOf("?");
  const response = await handler({
    httpMethod: req.method,
    headers: req.headers,
    body,
    rawQuery: queryIndex === -1 ? "" : req.originalUrl.slice(queryIndex + 1),
    isBase64Encoded: false,
  });

  for (const [name, value] of Object.entries(response.headers || {})) {
    res.setHeader(name, value);
  }
  res.status(response.statusCode || 200);
  if (response.isBase64Encoded) {
    return res.send(Buffer.from(response.body || "", "base64"));
  }
  return res.send(response.body || "");
};

for (const [route, handler] of Object.entries(functionHandlers)) {
  app.all(route, (req, res) => {
    invokeFunction(handler, req, res).catch((error) => {
      console.error(`Local function adapter failed for ${route}:`, error);
      res.status(500).json({ error: "Internal server error." });
    });
  });
}

app.listen(PORT, () => {
  posthogLogger.info("server_started");
  console.log(`Mowarson Portfolio & Payment Server running at http://localhost:${PORT}`);
});

process.once("beforeExit", () => {
  void shutdownPostHogLogs();
});
