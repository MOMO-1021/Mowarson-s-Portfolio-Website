exports.handler = async () => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json"
  };

  const useTestKeys =
    (process.env.PAYMENT_MODE || "").trim().toLowerCase() === "test";
  const rawKeyId =
    (useTestKeys ? process.env.RAZORPAY_TEST_KEY_ID : process.env.RAZORPAY_KEY_ID) || "";
  const key_id = rawKeyId.trim().replace(/^["']|["']$/g, "");

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
