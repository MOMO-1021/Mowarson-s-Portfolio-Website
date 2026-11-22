const jsonResponse = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...extraHeaders },
  body: JSON.stringify(body),
});

const getJsonHeaders = (methods) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  ...(methods ? { "Access-Control-Allow-Methods": methods } : {}),
  "Content-Type": "application/json",
});

module.exports = { getJsonHeaders, jsonResponse };
