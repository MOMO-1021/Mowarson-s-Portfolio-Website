(function () {
  const isDevelopment = ["localhost", "127.0.0.1"].includes(window.location.hostname);

  function reportMissing(variableName) {
    if (isDevelopment) {
      throw new Error(`${variableName} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variableName} is configured`);
    }
  }

  fetch("/api/config")
    .then((response) => (response.ok ? response.json() : {}))
    .then(({ posthog_key: key, posthog_host: host }) => {
      if (!key) {
        reportMissing("POSTHOG_PROJECT_TOKEN");
        return;
      }

      if (!host) {
        reportMissing("POSTHOG_HOST");
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.src = `${host.replace(".i.posthog.com", "-assets.i.posthog.com")}/static/array.js`;
      script.onload = function () {
        window.posthog.init(key, {
          api_host: host,
          defaults: "2026-08-30",
          opt_out_capturing_by_default: true,
          capture_pageview: false,
          capture_pageleave: true,
          capture_exceptions: {
            capture_unhandled_errors: true,
            capture_unhandled_rejections: true,
            capture_console_errors: false
          }
        });
        if (localStorage.getItem("mowarson_analytics_consent") === "granted") {
          window.posthog.opt_in_capturing();
        }
      };
      document.head.appendChild(script);
    })
    .catch(() => reportMissing("POSTHOG_PROJECT_TOKEN"));
})();
