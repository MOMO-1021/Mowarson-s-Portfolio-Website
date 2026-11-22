const { getJsonHeaders } = require("../shared/http");
const { getRazorpayCredentials } = require("../shared/razorpay");

exports.handler = async () => {
  const headers = {
    ...getJsonHeaders(),
    "Cache-Control": "no-store",
  };

  const { key_id } = getRazorpayCredentials();

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      key_id,
      posthog_key: process.env.POSTHOG_PROJECT_TOKEN || "",
      posthog_host: process.env.POSTHOG_HOST || ""
    })
  };
};
