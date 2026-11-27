import dotenv from "dotenv";
dotenv.config({ override: true });
import fs from "node:fs";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";

const root = process.cwd();
const dataDir = path.join(root, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const existingPosts = [
  {
    file: "blog/lead-generation-strategies.html",
    slug: "lead-generation-strategies",
    canonical_url: "https://mowarsondeveloper.netlify.app/blog/lead-generation-strategies.html",
    published_at: "2026-03-25T14:32:49Z",
    updated_at: "2026-11-22T00:32:23Z",
    created_at: "2026-03-25T14:32:49Z",
    featured_image: "https://mowarsondeveloper.netlify.app/My-Image.jpg",
    author: "Mowarson",
    status: "published",
    articleSection: "Lead Generation & Conversion",
    keywords: ["lead generation", "conversion rate optimization", "landing pages", "call to action", "small business marketing"],
    breadcrumbName: "Lead Generation Strategies"
  },
  {
    file: "blog/seo-friendly-website-design-tips.html",
    slug: "seo-friendly-website-design-tips",
    canonical_url: "https://mowarsondeveloper.netlify.app/blog/seo-friendly-website-design-tips.html",
    published_at: "2026-03-25T14:32:49Z",
    updated_at: "2026-11-22T00:32:23Z",
    created_at: "2026-03-25T14:32:49Z",
    featured_image: "https://mowarsondeveloper.netlify.app/My-Image.jpg",
    author: "Mowarson",
    status: "published",
    articleSection: "SEO & Web Design",
    keywords: ["SEO website design", "technical SEO", "keyword research", "page speed optimization", "mobile responsiveness"],
    breadcrumbName: "SEO Friendly Website Design Tips"
  },
  {
    file: "blog/web-design-consultant-tips.html",
    slug: "web-design-consultant-tips",
    canonical_url: "https://mowarsondeveloper.netlify.app/blog/web-design-consultant-tips.html",
    published_at: "2026-03-25T14:32:49Z",
    updated_at: "2026-11-22T00:32:23Z",
    created_at: "2026-03-25T14:32:49Z",
    featured_image: "https://mowarsondeveloper.netlify.app/My-Image.jpg",
    author: "Mowarson",
    status: "published",
    articleSection: "Web Consulting & Brand Positioning",
    keywords: ["web design consultant", "hiring a web designer", "brand positioning consultant", "website strategy", "small business web design"],
    breadcrumbName: "How to Choose a Web Design Consultant"
  }
];

const seededPosts = [];

for (const item of existingPosts) {
  const filePath = path.join(root, item.file);
  const html = fs.readFileSync(filePath, "utf8");

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : item.slug;

  const descMatch = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const description = descMatch ? descMatch[1].trim() : "";

  const articleMatch = html.match(/<article\s+class=["']blog-post["']>([\s\S]*?)<\/article>/i);
  const content = articleMatch ? articleMatch[1].trim() : "";

  seededPosts.push({
    slug: item.slug,
    title,
    description,
    content,
    author: item.author,
    featured_image: item.featured_image,
    status: item.status,
    published_at: item.published_at,
    updated_at: item.updated_at,
    canonical_url: item.canonical_url,
    created_at: item.created_at,
    articleSection: item.articleSection,
    keywords: item.keywords,
    breadcrumbName: item.breadcrumbName
  });
}

// Add an explicit draft post for testing safety
seededPosts.push({
  slug: "upcoming-ai-branding-guide",
  title: "Upcoming AI Branding Guide (Draft)",
  description: "Internal preview of modern AI branding workflows. Not for public indexing.",
  content: "<h1>Upcoming AI Branding Guide</h1><p>This draft guide is strictly in progress and must never appear publicly.</p>",
  author: "Mowarson",
  featured_image: "https://mowarsondeveloper.netlify.app/My-Image.jpg",
  status: "draft",
  published_at: null,
  updated_at: new Date().toISOString(),
  canonical_url: "https://mowarsondeveloper.netlify.app/blog/upcoming-ai-branding-guide.html",
  created_at: new Date().toISOString(),
  articleSection: "AI & Brand Strategy",
  keywords: ["AI branding", "draft"],
  breadcrumbName: "Upcoming AI Branding Guide"
});

const outputPath = path.join(dataDir, "posts.json");
fs.writeFileSync(outputPath, JSON.stringify(seededPosts, null, 2), "utf8");
console.log(`Saved ${seededPosts.length} posts (${seededPosts.filter(p => p.status === 'published').length} published, ${seededPosts.filter(p => p.status === 'draft').length} draft) into ${outputPath}`);

// Sync to Neon database if DATABASE_URL is available
const databaseUrl = (process.env.DATABASE_URL || "").trim();
if (databaseUrl) {
  try {
    const pool = new Pool({ connectionString: databaseUrl });
    for (const post of seededPosts) {
      const sql = `
        INSERT INTO posts (slug, title, description, content, author, featured_image, status, published_at, updated_at, canonical_url, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          content = EXCLUDED.content,
          author = EXCLUDED.author,
          featured_image = EXCLUDED.featured_image,
          status = EXCLUDED.status,
          published_at = EXCLUDED.published_at,
          updated_at = EXCLUDED.updated_at,
          canonical_url = EXCLUDED.canonical_url;
      `;
      const values = [
        post.slug,
        post.title,
        post.description,
        post.content,
        post.author,
        post.featured_image,
        post.status,
        post.published_at,
        post.updated_at,
        post.canonical_url,
        post.created_at
      ];
      await pool.query(sql, values);
      console.log(`Synced to Neon posts table: ${post.slug} (${post.status})`);
    }
    await pool.end();
  } catch (err) {
    console.warn(`Could not sync to Neon database (network/permissions): ${err.message}`);
  }
}
