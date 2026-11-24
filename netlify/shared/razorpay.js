const cleanCredential = (value) =>
  String(value || "").trim().replace(/^["']|["']$/g, "");

const isTestMode = () => {
  const context = (process.env.CONTEXT || "").trim().toLowerCase();
  const isPreview = (process.env.IS_PREVIEW || "").trim().toLowerCase() === "true";
  const paymentMode = (process.env.PAYMENT_MODE || "").trim().toLowerCase();
  return (
    paymentMode === "test" ||
    isPreview ||
    context === "deploy-preview" ||
    context === "branch-deploy"
  );
};

const getRazorpayCredentials = () => {
  const useTestKeys = isTestMode();
  const key_id = cleanCredential(
    useTestKeys ? process.env.RAZORPAY_TEST_KEY_ID : process.env.RAZORPAY_KEY_ID,
  );
  const key_secret = cleanCredential(
    useTestKeys
      ? process.env.RAZORPAY_TEST_KEY_SECRET
      : process.env.RAZORPAY_KEY_SECRET,
  );

  // Safety Assertion: Preview & test payments CANNOT use live Razorpay credentials under any circumstances!
  if (useTestKeys && key_id && !key_id.startsWith("rzp_test_")) {
    throw new Error(
      "Safety check failed: Preview / test mode is enabled but a live Razorpay Key ID was detected. Preview payments cannot use live Razorpay credentials.",
    );
  }

  return {
    useTestKeys,
    key_id,
    key_secret,
  };
};

module.exports = { getRazorpayCredentials, isTestMode };
