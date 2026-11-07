exports.handler = async () => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  const rawKeyId = process.env.RAZORPAY_KEY_ID || "";
  const key_id = rawKeyId.trim().replace(/^["']|["']$/g, "");

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ key_id })
  };
};
