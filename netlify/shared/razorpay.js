const cleanCredential = (value) =>
  String(value || "").trim().replace(/^["']|["']$/g, "");

const isTestMode = () =>
  (process.env.PAYMENT_MODE || "").trim().toLowerCase() === "test";

const getRazorpayCredentials = () => {
  const useTestKeys = isTestMode();
  return {
    useTestKeys,
    key_id: cleanCredential(
      useTestKeys ? process.env.RAZORPAY_TEST_KEY_ID : process.env.RAZORPAY_KEY_ID,
    ),
    key_secret: cleanCredential(
      useTestKeys
        ? process.env.RAZORPAY_TEST_KEY_SECRET
        : process.env.RAZORPAY_KEY_SECRET,
    ),
  };
};

module.exports = { getRazorpayCredentials, isTestMode };
