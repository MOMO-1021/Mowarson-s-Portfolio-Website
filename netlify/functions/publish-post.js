/**
 * Netlify Function: /api/publish-post
 * Secure server-side endpoint for admin / CMS content publishing.
 * Updates the database and triggers the Netlify build hook.
 * The build hook secret is protected and called only from this trusted server-side code.
 */

const { query } = require("../shared/db");
const { jsonResponse, getJsonHeaders } = require("../shared/http");

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const parseBody = (event) => {
  if (!event.body) return null;
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  if (contentType.includes("application/json") || typeof event.body === "string") {
    try {
      return JSON.parse(event.body);
    } catch {
      return null;
    }
  }
  return null;
};

const isAuthorized = (event) => {
  const adminKey = (process.env.ADMIN_API_KEY || "").trim();
  // If ADMIN_API_KEY is not set in development, allow local/dev invocation
  if (!adminKey) return true;

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const customHeader = event.headers["x-admin-key"] || event.headers["X-Admin-Key"] || "";

  if (authHeader.startsWith("Bearer ") && authHeader.slice(7).trim() === adminKey) {
    return true;
  }
  if (customHeader.trim() === adminKey) {
    return true;
  }
  return false;
};

exports.handler = async (event) => {
  const headers = getJsonHeaders("POST, OPTIONS");

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." }, headers);
  }

  // Security Check: Protect build hook and admin actions
  if (!isAuthorized(event)) {
    return jsonResponse(401, { error: "Unauthorized. Valid admin API key required." }, headers);
  }

  const payload = parseBody(event);
  if (!payload) {
    return jsonResponse(400, { error: "Invalid JSON body." }, headers);
  }

  const {
    slug,
    title,
    description,
    content,
    author = "Mowarson",
    featured_image = "https://mowarsondeveloper.netlify.app/My-Image.jpg",
    status = "published"
  } = payload;

  // Validate required fields
  if (!slug || typeof slug !== "string" || !SLUG_REGEX.test(slug)) {
    return jsonResponse(400, { error: "Valid slug is required (lowercase letters, numbers, hyphens only)." }, headers);
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    return jsonResponse(400, { error: "Title is required." }, headers);
  }
  if (!description || typeof description !== "string" || !description.trim()) {
    return jsonResponse(400, { error: "Description is required." }, headers);
  }
  if (!content || typeof content !== "string" || !content.trim()) {
    return jsonResponse(400, { error: "Content is required." }, headers);
  }
  if (!["draft", "published", "archived"].includes(status)) {
    return jsonResponse(400, { error: "Status must be 'draft', 'published', or 'archived'." }, headers);
  }

  const canonicalUrl = `https://mowarsondeveloper.netlify.app/blog/${slug}.html`;

  try {
    // 1. Update Neon database
    const sql = `
      INSERT INTO posts (slug, title, description, content, author, featured_image, status, published_at, updated_at, canonical_url, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7,
        CASE WHEN $7 = 'published' THEN NOW() ELSE NULL END,
        NOW(),
        $8,
        NOW()
      )
      ON CONFLICT (slug) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        content = EXCLUDED.content,
        author = EXCLUDED.author,
        featured_image = EXCLUDED.featured_image,
        status = EXCLUDED.status,
        published_at = CASE WHEN EXCLUDED.status = 'published' THEN COALESCE(posts.published_at, NOW()) ELSE posts.published_at END,
        updated_at = NOW(),
        canonical_url = EXCLUDED.canonical_url
      RETURNING id, slug, title, status, published_at, updated_at, canonical_url;
    `;
    const values = [slug, title.trim(), description.trim(), content.trim(), author.trim(), featured_image, status, canonicalUrl];
    const dbResult = await query(sql, values);
    const savedPost = dbResult.rows[0];

    // 2. Trigger Netlify Build Hook (if published)
    let buildHookTriggered = false;
    let buildHookMessage = "No build hook URL configured (local mode)";

    const buildHookUrl = (process.env.NETLIFY_BUILD_HOOK_URL || "").trim();
    if (status === "published" && buildHookUrl) {
      try {
        const hookResponse = await fetch(buildHookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trigger_title: `Published blog post: ${savedPost.title}`,
            clear_cache: false
          })
        });
        buildHookTriggered = hookResponse.ok;
        buildHookMessage = hookResponse.ok
          ? "Netlify build hook triggered successfully"
          : `Netlify build hook responded with HTTP ${hookResponse.status}`;
      } catch (hookErr) {
        buildHookMessage = `Failed to contact Netlify build hook: ${hookErr.message}`;
      }
    } else if (status === "published") {
      buildHookMessage = "Post published in database. Configure NETLIFY_BUILD_HOOK_URL for automatic remote rebuilds.";
    } else {
      buildHookMessage = `Post saved with status '${status}'. Rebuild not triggered for non-published status.`;
    }

    return jsonResponse(200, {
      success: true,
      post: savedPost,
      build_hook_triggered: buildHookTriggered,
      build_hook_status: buildHookMessage
    }, headers);
  } catch (error) {
    console.error("Publish post error:", error);
    return jsonResponse(500, { error: "Failed to publish post: " + error.message }, headers);
  }
};
