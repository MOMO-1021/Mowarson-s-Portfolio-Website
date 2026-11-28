import dotenv from "dotenv";
dotenv.config({ override: true });
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Pool } from "@neondatabase/serverless";

const root = process.cwd();
const postsJsonPath = path.join(root, "data", "posts.json");

/**
 * Publish a blog post and trigger the rebuild workflow.
 */
export async function publishPost(postData, options = { triggerLocalBuild: true }) {
  const {
    slug,
    title,
    description,
    content,
    author = "Mowarson",
    featured_image = "https://mowarsondeveloper.netlify.app/My-Image.jpg",
    status = "published",
    articleSection = "SEO & Web Design",
    keywords = ["SEO Website Design", "Monthly SEO Packages"],
    breadcrumbName
  } = postData;

  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Invalid slug: '${slug}'. Must be lowercase letters, numbers, and hyphens.`);
  }
  if (!title || !title.trim()) throw new Error("Title is required.");
  if (!description || !description.trim()) throw new Error("Description is required.");
  if (!content || !content.trim()) throw new Error("Content is required.");
  if (!["draft", "published", "archived"].includes(status)) {
    throw new Error("Status must be 'draft', 'published', or 'archived'.");
  }

  const canonical_url = `https://mowarsondeveloper.netlify.app/blog/${slug}.html`;
  const now = new Date().toISOString();

  // 1. Update Neon database if DATABASE_URL is available
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  let dbUpdated = false;

  if (databaseUrl) {
    try {
      const pool = new Pool({ connectionString: databaseUrl });
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
      const values = [slug, title.trim(), description.trim(), content.trim(), author.trim(), featured_image, status, canonical_url];
      const res = await pool.query(sql, values);
      await pool.end();
      dbUpdated = true;
      console.log(`✅ Database updated in Neon: ${slug} (status: ${status})`);
    } catch (err) {
      console.warn(`Could not update Neon database (${err.message}). Updating local source.`);
    }
  }

  // 2. Update local data/posts.json
  let posts = [];
  if (fs.existsSync(postsJsonPath)) {
    posts = JSON.parse(fs.readFileSync(postsJsonPath, "utf8"));
  }

  const existingIndex = posts.findIndex((p) => p.slug === slug);
  const postRecord = {
    slug,
    title: title.trim(),
    description: description.trim(),
    content: content.trim(),
    author: author.trim(),
    featured_image,
    status,
    published_at: status === "published" ? (posts[existingIndex]?.published_at || now) : null,
    updated_at: now,
    canonical_url,
    created_at: posts[existingIndex]?.created_at || now,
    articleSection,
    keywords,
    breadcrumbName: breadcrumbName || title.trim()
  };

  if (existingIndex >= 0) {
    posts[existingIndex] = postRecord;
  } else {
    posts.unshift(postRecord);
  }

  fs.writeFileSync(postsJsonPath, JSON.stringify(posts, null, 2), "utf8");
  console.log(`✅ Local posts source updated: ${postsJsonPath}`);

  // 3. Trigger Netlify build hook if configured
  const buildHookUrl = (process.env.NETLIFY_BUILD_HOOK_URL || "").trim();
  let buildHookTriggered = false;

  if (status === "published" && buildHookUrl) {
    try {
      const hookRes = await fetch(buildHookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger_title: `Published blog post: ${title.trim()}`
        })
      });
      buildHookTriggered = hookRes.ok;
      console.log(`✅ Netlify build hook triggered (HTTP ${hookRes.status})`);
    } catch (hookErr) {
      console.warn(`⚠️ Failed to trigger Netlify build hook: ${hookErr.message}`);
    }
  }

  // 4. Trigger local rebuild if requested
  if (options.triggerLocalBuild && status === "published") {
    console.log("🔄 Triggering site rebuild (generate-blog, generate-seo, validate-seo)...");
    execSync("node scripts/generate-blog.mjs && node scripts/generate-seo.mjs && node scripts/validate-seo.mjs", {
      stdio: "inherit"
    });
    console.log(`🎉 Site rebuilt successfully! New page is accessible at: /blog/${slug}.html`);
  }

  return {
    success: true,
    post: postRecord,
    dbUpdated,
    buildHookTriggered
  };
}

// Allow CLI execution if called directly
if (process.argv[1] && process.argv[1].endsWith("publish-post.mjs")) {
  const args = process.argv.slice(2);
  if (args.length >= 4) {
    const [slug, title, description, content] = args;
    publishPost({ slug, title, description, content, status: "published" }).catch((err) => {
      console.error("Publish failed:", err);
      process.exit(1);
    });
  } else {
    console.log("Usage: node scripts/publish-post.mjs <slug> <title> <description> <content>");
  }
}
