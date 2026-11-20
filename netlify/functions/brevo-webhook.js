const { PostHog } = require("posthog-node");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const userEmail = body.email || (body.contact && body.contact.email);

    if (!userEmail) {
      return { statusCode: 400, body: "Missing email" };
    }

    const posthogToken = process.env.POSTHOG_PROJECT_TOKEN;

    // Initialize PostHog using the variable
    const posthog = new PostHog(posthogToken, {
      host: "https://us.i.posthog.com", // Or eu.i.posthog.com
      flushAt: 1,
      flushInterval: 0,
    });

    await posthog.captureImmediate({
      distinctId: userEmail,
      event: "generate_lead",
      properties: {
        source: "brevo_form",
        email: userEmail,
      },
    });

    await posthog.shutdown();

    return { statusCode: 200, body: "Success" };
  } catch (error) {
    console.error("Error:", error);
    return { statusCode: 500, body: "Internal Server Error" };
  }
};
