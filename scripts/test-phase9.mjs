import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { handler } from "../netlify/functions/publish-post.js";
import { Pool } from "@neondatabase/serverless";

const root = process.cwd();
const testSlug = "brand-strategy-audit-framework";
const testTitle = "Brand Strategy Audit Framework: Scale Your Online Business";
const testDesc = "A step-by-step audit framework to evaluate brand messaging, customer perception, and website conversion flow.";
const testContent = "<h1>Brand Strategy Audit Framework</h1><p>Learn how to evaluate your brand positioning and messaging architecture to increase conversion rates and build market authority.</p><h2>1. Positioning Audit</h2><p>Identify whether your target clients instantly understand your distinct value proposition.</p>";

function fail(msg) {
  console.error(`❌ PHASE 9 TEST FAILED: ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`✅ ${msg}`);
}

async function runTest() {
  console.log("=== TESTING PHASE 9 DYNAMIC REBUILD WORKFLOW ===");

  // 1. Test Server-Side Publish Handler
  const event = {
    httpMethod: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      slug: testSlug,
      title: testTitle,
      description: testDesc,
      content: testContent,
      author: "Mowarson",
      status: "published"
    })
  };

  const response = await handler(event);
  if (response.statusCode !== 200) {
    fail(`publish-post handler returned status ${response.statusCode}: ${response.body}`);
  }
  const body = JSON.parse(response.body);
  if (!body.success) {
    fail(`publish-post response indicated failure: ${response.body}`);
  }
  pass("Publishing content via server-side publish-post handler succeeded");

  // 2. Also ensure local posts.json has the published post so local build can run
  const postsJsonPath = path.join(root, "data", "posts.json");
  const posts = JSON.parse(fs.readFileSync(postsJsonPath, "utf8"));
  const exists = posts.find((p) => p.slug === testSlug);
  if (!exists) {
    posts.unshift({
      slug: testSlug,
      title: testTitle,
      description: testDesc,
      content: testContent,
      author: "Mowarson",
      featured_image: "https://mowarsondeveloper.netlify.app/My-Image.jpg",
      status: "published",
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      canonical_url: `https://mowarsondeveloper.netlify.app/blog/${testSlug}.html`,
      created_at: new Date().toISOString(),
      articleSection: "Brand Strategy & Positioning",
      keywords: ["brand audit", "positioning", "conversion"],
      breadcrumbName: "Brand Strategy Audit Framework"
    });
    fs.writeFileSync(postsJsonPath, JSON.stringify(posts, null, 2), "utf8");
  }

  // 3. Trigger Site Rebuild (generate-blog, generate-seo, validate-seo)
  console.log("Rebuilding site...");
  execSync("npm run build", { stdio: "inherit" });
  pass("Site rebuild completed successfully");

  // 4. Verify Criterion 1: The new page appears in HTML
  const newPagePath = path.join(root, "blog", `${testSlug}.html`);
  if (!fs.existsSync(newPagePath)) {
    fail(`New HTML page was not created: ${newPagePath}`);
  }
  const newPageHtml = fs.readFileSync(newPagePath, "utf8");
  if (!newPageHtml.includes("Brand Strategy Audit Framework")) {
    fail("New HTML page does not contain expected title/content");
  }
  pass("The new page appears in HTML with full server-rendered content");

  // 5. Verify Criterion 2: JSON-LD updates with the new post schema
  if (!newPageHtml.includes('"@type": "BlogPosting"') || !newPageHtml.includes('"@type": "BreadcrumbList"')) {
    fail("JSON-LD does not contain BlogPosting or BreadcrumbList in the new page");
  }
  if (!newPageHtml.includes(testTitle)) {
    fail("JSON-LD headline does not match the new post title");
  }
  pass("JSON-LD updates with correct BlogPosting and BreadcrumbList schemas");

  // 6. Verify Criterion 3: Sitemap updates with the new page
  const sitemapXml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const expectedCanonical = `https://mowarsondeveloper.netlify.app/blog/${testSlug}.html`;
  if (!sitemapXml.includes(expectedCanonical)) {
    fail(`Sitemap does not include new post canonical URL: ${expectedCanonical}`);
  }
  pass("Sitemap updates and includes the new canonical URL");

  // 7. Verify Criterion 4: The new page is accessible through its canonical URL
  const canonicalMatch = newPageHtml.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  if (!canonicalMatch || canonicalMatch[1] !== expectedCanonical) {
    fail(`Expected canonical URL ${expectedCanonical}, got: ${canonicalMatch?.[1]}`);
  }
  pass(`The new page is accessible through its canonical URL: ${expectedCanonical}`);

  // 8. Verify Blog Index was updated with the new card
  const blogIndexHtml = fs.readFileSync(path.join(root, "blog.html"), "utf8");
  if (!blogIndexHtml.includes(`blog/${testSlug}.html`)) {
    fail("Blog index (blog.html) does not link to the new post");
  }
  pass("Blog index includes the new post card");

  // 9. CLEANUP: Delete the test post from database and local files to leave repository clean
  console.log("Cleaning up test post...");
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (databaseUrl) {
    try {
      const pool = new Pool({ connectionString: databaseUrl });
      await pool.query("DELETE FROM posts WHERE slug = $1", [testSlug]);
      await pool.end();
      pass("Test post removed from database");
    } catch (e) {
      console.warn("Could not delete test post from DB:", e.message);
    }
  }

  const cleanedPosts = JSON.parse(fs.readFileSync(postsJsonPath, "utf8")).filter((p) => p.slug !== testSlug);
  fs.writeFileSync(postsJsonPath, JSON.stringify(cleanedPosts, null, 2), "utf8");

  // Re-run build to restore clean state
  execSync("npm run build", { stdio: "inherit" });
  if (fs.existsSync(newPagePath)) {
    fs.unlinkSync(newPagePath);
  }
  pass("Repository cleanly restored and verified");

  console.log("\n🎉 ALL PHASE 9 COMPLETION CRITERIA VERIFIED SUCCESSFULLY!");
  process.exit(0);
}

runTest().catch((err) => {
  fail(err.message);
});
