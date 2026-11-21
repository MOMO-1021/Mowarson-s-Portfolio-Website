const crypto = require("crypto");

const sign = (value, secret) =>
  crypto.createHmac("sha256", secret).update(value).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const secureEqual = (a, b) => {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
};

const getCookie = (event, name) => {
  const cookieHeader = event.headers.cookie || event.headers.Cookie || "";
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
};

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const token = event.queryStringParameters?.token || "";
  const cookieToken = getCookie(event, "thank_you_token");
  const secret = (process.env.THANK_YOU_TOKEN_SECRET || "").trim();
  const pixelId = (process.env.PIXEL_ID || "").trim();
  const secure = event.headers["x-forwarded-proto"] === "https";

  if (!token || !cookieToken || !secureEqual(token, cookieToken) || !secret) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valid: false }),
    };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valid: false }),
    };
  }

  const [payload, signature] = parts;
  if (!secureEqual(signature, sign(payload, secret))) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valid: false }),
    };
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    if (!pixelId || !decoded.eventId || !Number.isSafeInteger(decoded.expiresAt) || decoded.expiresAt < Date.now()) {
      throw new Error("Expired thank-you token");
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `thank_you_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`,
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({ valid: true, eventId: decoded.eventId, pixelId }),
    };
  } catch (error) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ valid: false }),
    };
  }
};
