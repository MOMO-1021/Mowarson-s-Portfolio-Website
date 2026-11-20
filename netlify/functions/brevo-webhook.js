const { PostHog } = require("posthog-node");

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // 1. Parse the data sent from Brevo
    const body = JSON.parse(event.body);

    // 2. Get the user's email from Brevo's data
    // Note: Depending on the Brevo event, the email might be in body.email or body.contact.email
    const userEmail = body.email || (body.contact && body.contact.email);

    if (!userEmail) {
      console.log("No email found in payload:", body);
      return { statusCode: 400, body: "Missing email" };
    }

    // 3. Initialize PostHog (REPLACE WITH YOUR ACTUAL KEY)
    const posthog = new PostHog(
      "phc_r5uhzHqeaAysDcyk5rhyUCCU6CT9ownGBNsTkovWCvHX",
      {
        host: "https://us.i.posthog.com", // Change to https://eu.i.posthog.com if your PostHog is in the EU
        flushAt: 1,
        flushInterval: 0,
      },
    );

    // 4. Tell PostHog: this user generated a "generate_lead" event
    await posthog.captureImmediate({
      distinctId: userEmail, // Use the email as the distinct_id
      event: "generate_lead",
      properties: {
        source: "brevo_form",
        email: userEmail,
      },
    });

    // 5. Close the connection to ensure the event is sent immediately
    await posthog.shutdown();

    return { statusCode: 200, body: "Success" };
  } catch (error) {
    console.error("Error:", error);
    return { statusCode: 500, body: "Internal Server Error" };
  }
};
