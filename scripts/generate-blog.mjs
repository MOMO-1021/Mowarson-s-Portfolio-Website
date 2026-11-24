import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";
import { siteConfig } from "./site-config.mjs";

const root = process.cwd();
const blogDir = path.join(root, "blog");
const postsJsonPath = path.join(root, "data", "posts.json");

if (!fs.existsSync(blogDir)) {
  fs.mkdirSync(blogDir, { recursive: true });
}

function failBuild(message) {
  console.error(`\n❌ BLOG GENERATION FAILED: ${message}\n`);
  process.exit(1);
}

function validatePost(post) {
  if (!post.slug || typeof post.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) {
    failBuild(`Invalid or malformed slug '${post?.slug}'`);
  }
  if (!post.title || typeof post.title !== "string" || !post.title.trim()) {
    failBuild(`Post '${post.slug}' has missing or empty title.`);
  }
  if (!post.description || typeof post.description !== "string" || !post.description.trim()) {
    failBuild(`Post '${post.slug}' has missing or empty description.`);
  }
  if (!post.content || typeof post.content !== "string" || !post.content.trim()) {
    failBuild(`Post '${post.slug}' has missing or empty content.`);
  }
  if (post.status !== "published") {
    failBuild(`Attempted to generate public page for non-published post '${post.slug}' (status: ${post.status})`);
  }
}

async function fetchPublishedPosts() {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  let fetchedFromDb = false;
  let dbPosts = [];

  if (databaseUrl) {
    try {
      const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
      const res = await pool.query(
        "SELECT id, slug, title, description, content, author, featured_image, status, published_at, updated_at, canonical_url, created_at FROM posts WHERE status = 'published' ORDER BY published_at DESC"
      );
      await pool.end();
      if (res.rows && res.rows.length > 0) {
        dbPosts = res.rows;
        fetchedFromDb = true;
        console.log(`Fetched ${dbPosts.length} published posts from Neon database.`);
      }
    } catch (err) {
      console.warn(`Neon database connection skipped or failed (${err.message}). Using local content source.`);
    }
  }

  if (fetchedFromDb && dbPosts.length > 0) {
    return dbPosts;
  }

  // Fallback to local data/posts.json
  if (fs.existsSync(postsJsonPath)) {
    try {
      const localPosts = JSON.parse(fs.readFileSync(postsJsonPath, "utf8"));
      const published = localPosts.filter((p) => p.status === "published");
      console.log(`Loaded ${published.length} published posts from local content source (${postsJsonPath}).`);
      return published;
    } catch (err) {
      failBuild(`Failed to parse local content source ${postsJsonPath}: ${err.message}`);
    }
  }

  failBuild("No posts found in database or local content source.");
}

function renderBlogPostHtml(post) {
  const canonicalUrl = post.canonical_url || `${siteConfig.productionUrl}/blog/${post.slug}.html`;
  const breadcrumbName = post.breadcrumbName || post.title.split("–")[0].split("-")[0].trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${post.title}</title>
  <meta name="description" content="${post.description}">
  <link rel="canonical" href="${canonicalUrl}" />
  <link rel="stylesheet" href="../style.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="icon" href="../assets/favicon.png" type="image/png" />
  <link rel="apple-touch-icon" href="../assets/apple-touch-icon.png" />
  
  <!-- Hreflang tags -->
  <link rel="alternate" hreflang="en" href="${canonicalUrl}">
  <link rel="alternate" hreflang="x-default" href="${canonicalUrl}">
  
  <style>
    .blog-post {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 32px;
      padding: 48px;
      box-shadow: 0 20px 40px -20px rgba(0,0,0,0.15);
      border: 1px solid #eef2f6;
    }
    .blog-post h1 {
      font-size: 2.5rem;
      margin-bottom: 24px;
      color: #0f172a;
    }
    .blog-post h2 {
      font-size: 1.8rem;
      margin: 48px 0 16px;
      color: #1e293b;
    }
    .blog-post p, .blog-post li {
      color: #475569;
      font-size: 1.1rem;
      line-height: 1.7;
    }
    .blog-post ul, .blog-post ol {
      margin-bottom: 24px;
      padding-left: 24px;
    }
    .blog-post li {
      margin-bottom: 8px;
    }
    .blog-post strong {
      color: #0f172a;
    }
    /* Video embed styles */
    .video-wrapper {
      margin: 40px 0;
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 20px 30px -10px rgba(0,0,0,0.2);
      background: #f1f5f9;
    }
    .video-container {
      position: relative;
      padding-bottom: 56.25%;
      height: 0;
    }
    .video-container iframe {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: 0;
    }
    .video-caption {
      text-align: center;
      font-size: 0.9rem;
      color: #64748b;
      padding: 12px 16px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }
    /* Related articles grid */
    .related-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-top: 60px;
    }
    .related-card {
      background: #f8fafc;
      border-radius: 24px;
      padding: 24px;
      border: 1px solid #eef2f6;
      transition: all 0.2s;
    }
    .related-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 15px 30px -10px rgba(0,0,0,0.1);
      background: white;
    }
    .related-card h3 {
      font-size: 1.3rem;
      margin: 0 0 12px;
    }
    .related-card h3 a {
      text-decoration: none;
      color: #0f172a;
    }
    .related-card h3 a:hover {
      color: #2563eb;
    }
    .related-card p {
      color: #475569;
      font-size: 0.95rem;
      margin-bottom: 16px;
      line-height: 1.5;
    }
    .related-card .read-more {
      font-weight: 600;
      color: #2563eb;
      text-decoration: none;
      font-size: 0.9rem;
    }
    .related-card .read-more:hover {
      text-decoration: underline;
    }
    @media (max-width: 1024px) {
      .blog-post {
        padding: 36px 28px;
        border-radius: 28px;
      }
      .blog-post h1 {
        font-size: 2.2rem;
      }
      .blog-post h2 {
        font-size: 1.6rem;
        margin: 36px 0 14px;
      }
    }
    @media (max-width: 768px) {
      .blog-post {
        padding: 28px 20px !important;
        border-radius: 24px !important;
        box-shadow: 0 8px 24px -10px rgba(0, 0, 0, 0.08) !important;
      }
      .blog-post h1 {
        font-size: 1.95rem !important;
        line-height: 1.25 !important;
        margin-bottom: 18px !important;
      }
      .blog-post h2 {
        font-size: 1.45rem !important;
        line-height: 1.3 !important;
        margin: 36px 0 12px !important;
      }
      .blog-post p,
      .blog-post li {
        font-size: 1.02rem !important;
        line-height: 1.65 !important;
      }
      .blog-post ul,
      .blog-post ol {
        margin-bottom: 20px !important;
        padding-left: 20px !important;
      }
      .video-wrapper {
        margin: 28px 0 !important;
        border-radius: 18px !important;
      }
      .blog-post div[style*="background: #2563eb10"],
      .blog-lead-callout {
        padding: 20px 18px !important;
        margin: 32px 0 !important;
        border-radius: 18px !important;
      }
      .related-grid {
        grid-template-columns: 1fr !important;
        gap: 16px !important;
        margin-top: 36px !important;
      }
      .related-card {
        padding: 20px 18px !important;
        border-radius: 18px !important;
      }
    }
    @media (max-width: 480px) {
      .blog-post {
        padding: 20px 16px !important;
        border-radius: 20px !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04) !important;
      }
      .blog-post h1 {
        font-size: 1.65rem !important;
        line-height: 1.24 !important;
        margin-bottom: 14px !important;
      }
      .blog-post h2 {
        font-size: 1.28rem !important;
        margin: 28px 0 10px !important;
      }
      .blog-post p,
      .blog-post li {
        font-size: 0.95rem !important;
        line-height: 1.6 !important;
      }
      .blog-post ul,
      .blog-post ol {
        margin-bottom: 16px !important;
        padding-left: 18px !important;
      }
      .video-wrapper {
        margin: 20px 0 !important;
        border-radius: 14px !important;
      }
      .blog-post div[style*="background: #2563eb10"],
      .blog-lead-callout {
        padding: 16px 14px !important;
        margin: 24px 0 !important;
        border-radius: 16px !important;
      }
      .related-grid {
        gap: 12px !important;
        margin-top: 28px !important;
      }
      .related-card {
        padding: 16px 14px !important;
        border-radius: 14px !important;
      }
      .related-card h3 {
        font-size: 1.15rem !important;
        margin-bottom: 8px !important;
      }
      .related-card p {
        font-size: 0.9rem !important;
        margin-bottom: 12px !important;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="container header-inner">
      <a href="../index.html" class="logo">Mowarson<span>Developer</span></a>
      
      <!-- Hamburger button (visible on mobile) -->
      <button class="hamburger" aria-label="Menu">
        <span></span>
        <span></span>
        <span></span>
      </button>

      <nav class="nav">
        <a href="../about.html">About</a>
        <a href="../services.html">Services</a>
        <a href="../blog.html">Blog</a>
        <a href="../contact.html">Contact</a>
        <a href="../pay.html" class="btn btn-small" style="background: #2563eb; color: #ffffff; padding: 6px 16px; border-radius: 8px;">Pay Online</a>
      </nav>
    </div>
  </header>

  <nav aria-label="Breadcrumb" class="breadcrumb-nav">
    <div class="container">
      <ol class="breadcrumb" itemscope itemtype="https://schema.org/BreadcrumbList">
        <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem"><a itemprop="item" href="../index.html"><span itemprop="name">Home</span></a><meta itemprop="position" content="1" /></li>
        <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem"><a itemprop="item" href="../blog.html"><span itemprop="name">Blog</span></a><meta itemprop="position" content="2" /></li>
        <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem"><span itemprop="name" aria-current="page">${breadcrumbName}</span><meta itemprop="position" content="3" /></li>
      </ol>
    </div>
  </nav>

  <main class="container">
    <article class="blog-post">
${post.content.trim()}
    </article>
  </main>

  <!-- WhatsApp Button -->
  <a
    href="https://wa.me/916009825938"
    class="whatsapp-float"
    target="_blank" rel="noopener"
  >
    <img src="../Whatsapp.svg" alt="WhatsApp" />
  </a>
  <script src="/posthog-init.js"></script>
  <script src="../script.js"></script>
</body>
</html>`;
}

function updateBlogIndex(publishedPosts) {
  const blogIndexPath = path.join(root, "blog.html");
  if (!fs.existsSync(blogIndexPath)) return;

  let blogHtml = fs.readFileSync(blogIndexPath, "utf8");

  const cardsHtml = publishedPosts
    .map(
      (p) => `          <div class="card">
            <h3>
              <a
                href="blog/${p.slug}.html"
                style="text-decoration: none; color: inherit"
                >${p.title}</a
              >
            </h3>
            <p>
              ${p.description}
            </p>
            <a href="blog/${p.slug}.html" class="btn-small"
              >Read More →</a
            >
          </div>`
    )
    .join("\n");

  const gridRegex = /(<!-- (?:Original \d+ Articles Grid|Dynamic Articles Grid) -->\s*<div class="grid">)[\s\S]*?(<\/div>\s*<!-- 100% FREE NEWSLETTER SECTION)/i;
  if (gridRegex.test(blogHtml)) {
    const updated = blogHtml.replace(gridRegex, `$1\n${cardsHtml}\n        $2`);
    if (updated !== blogHtml) {
      fs.writeFileSync(blogIndexPath, updated, "utf8");
      console.log(`Updated blog index (blog.html) with ${publishedPosts.length} published post cards.`);
    }
  }
}

async function buildBlog() {
  console.log("=== BUILD-TIME DYNAMIC BLOG GENERATION ===");

  const publishedPosts = await fetchPublishedPosts();

  // Validate each published post
  for (const post of publishedPosts) {
    validatePost(post);
  }

  const publishedSlugs = new Set(publishedPosts.map((p) => p.slug));

  // Remove any stale / draft / archived HTML files from blog/ directory
  if (fs.existsSync(blogDir)) {
    const existingHtmlFiles = fs.readdirSync(blogDir).filter((f) => f.endsWith(".html"));
    for (const file of existingHtmlFiles) {
      const slug = file.replace(/\.html$/, "");
      if (!publishedSlugs.has(slug)) {
        console.warn(`Removing non-published or draft post file: blog/${file}`);
        fs.unlinkSync(path.join(blogDir, file));
      }
    }
  }

  // Generate each published post page
  for (const post of publishedPosts) {
    const postFilePath = path.join(blogDir, `${post.slug}.html`);
    const renderedHtml = renderBlogPostHtml(post);

    const existing = fs.existsSync(postFilePath) ? fs.readFileSync(postFilePath, "utf8") : "";
    // Only write if changed or file doesn't exist
    if (existing !== renderedHtml) {
      fs.writeFileSync(postFilePath, renderedHtml, "utf8");
      console.log(`Generated HTML page: blog/${post.slug}.html`);
    } else {
      console.log(`Unchanged: blog/${post.slug}.html`);
    }
  }

  // Update blog index page (blog.html)
  updateBlogIndex(publishedPosts);

  console.log(`Successfully generated ${publishedPosts.length} published blog pages at build time.`);
}

buildBlog().catch((err) => {
  failBuild(err.message);
});
