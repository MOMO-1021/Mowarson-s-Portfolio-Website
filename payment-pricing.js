const crypto = require("crypto");

const CURRENCIES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "AED",
  "QAR",
  "SGD",
  "CNY",
  "HKD",
];

const PLAN_PRICES_USD = {
  website: 5000,
  marketing: 6500,
};

const QUOTE_LIFETIME_MS = 30 * 60 * 1000;
const RATE_CACHE_LIFETIME_MS = 60 * 60 * 1000;
let cachedRates;
let cachedRatesAt = 0;

function getCurrency(currency) {
  const code = String(currency || "").toUpperCase();
  if (!CURRENCIES.includes(code)) {
    throw new Error("Please choose a supported payment currency.");
  }
  return code;
}

async function getUsdRates() {
  if (cachedRates && Date.now() - cachedRatesAt < RATE_CACHE_LIFETIME_MS) {
    return cachedRates;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Exchange-rate service returned HTTP ${response.status}.`);
    }

    const data = await response.json();
    if (data.result !== "success" || !data.rates || !Number.isFinite(data.rates.INR)) {
      throw new Error("Exchange-rate service returned invalid rate data.");
    }

    cachedRates = data.rates;
    cachedRatesAt = Date.now();
    return cachedRates;
  } finally {
    clearTimeout(timeoutId);
  }
}

function createQuoteToken({ plan, currency, amount, issuedAt }, secret) {
  const quote = {
    plan,
    currency,
    amount,
    issuedAt,
    expiresAt: issuedAt + QUOTE_LIFETIME_MS,
  };
  const encoded = Buffer.from(JSON.stringify(quote)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("hex");

  return `${encoded}.${signature}`;
}

function createPlanQuote(plan, currency, usdRate, secret) {
  const code = getCurrency(currency);
  const usdAmount = PLAN_PRICES_USD[plan];
  if (!usdAmount) {
    throw new Error("Please choose a valid service.");
  }

  let amount;
  if (code === "INR") {
    amount = plan === "website" ? 400000 : 500000;
  } else {
    if (!Number.isFinite(usdRate) || usdRate <= 0) {
      throw new Error(`A valid ${code} exchange rate is unavailable.`);
    }
    amount = Math.round((usdAmount / 100) * usdRate * 100);
  }

  const issuedAt = Date.now();
  return {
    amount,
    currency: code,
    usdRate,
    token: createQuoteToken({ plan, currency: code, amount, issuedAt }, secret),
  };
}

async function createPlanQuotes(currency, secret) {
  const code = getCurrency(currency);
  if (!secret) {
    throw new Error("Razorpay secret key is not configured.");
  }

  let usdRate = null;
  let rates;
  if (code !== "INR") {
    rates = await getUsdRates();
    usdRate = rates[code];
    if (!Number.isFinite(usdRate) || usdRate <= 0) {
      throw new Error(`An exchange rate for ${code} is unavailable.`);
    }
  }

  return {
    currency: code,
    usdRate,
    inrRate: code === "INR" ? null : rates.INR,
    website: createPlanQuote("website", code, usdRate, secret),
    marketing: createPlanQuote("marketing", code, usdRate, secret),
  };
}

function createCustomQuote(currency, customAmount, secret) {
  const code = getCurrency(currency);
  const amount = Number(customAmount);
  if (!Number.isFinite(amount) || amount < 1 || Math.round(amount * 100) < 100) {
    throw new Error("Enter a valid amount of at least 1.00.");
  }
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    throw new Error(`Enter an amount with no more than two decimal places.`);
  }
  if (!secret) {
    throw new Error("Razorpay secret key is not configured.");
  }

  const issuedAt = Date.now();
  const amountInMinorUnits = Math.round(amount * 100);
  return {
    amount: amountInMinorUnits,
    currency: code,
    token: createQuoteToken(
      { plan: "custom", currency: code, amount: amountInMinorUnits, issuedAt },
      secret,
    ),
  };
}

function verifyQuoteToken(token, secret) {
  if (typeof token !== "string" || !secret) {
    throw new Error("A valid payment quote is required.");
  }

  const [encoded, suppliedSignature, extra] = token.split(".");
  if (
    !encoded ||
    !/^[a-f0-9]{64}$/i.test(suppliedSignature) ||
    extra
  ) {
    throw new Error("The payment quote is invalid. Please refresh and try again.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const suppliedBuffer = Buffer.from(suppliedSignature, "hex");
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    throw new Error("The payment quote is invalid. Please refresh and try again.");
  }

  let quote;
  try {
    quote = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("The payment quote is invalid. Please refresh and try again.");
  }

  if (
    !["website", "marketing", "custom"].includes(quote.plan) ||
    !CURRENCIES.includes(quote.currency) ||
    !Number.isSafeInteger(quote.amount) ||
    quote.amount < 100 ||
    !Number.isSafeInteger(quote.issuedAt) ||
    !Number.isSafeInteger(quote.expiresAt)
  ) {
    throw new Error("The payment quote is invalid. Please refresh and try again.");
  }
  if (Date.now() > quote.expiresAt) {
    throw new Error("Your price quote expired. Please refresh the price and try again.");
  }

  return quote;
}

module.exports = {
  CURRENCIES,
  createCustomQuote,
  createPlanQuotes,
  verifyQuoteToken,
};
