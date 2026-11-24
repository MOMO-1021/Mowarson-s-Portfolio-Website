import fs from "node:fs";
import path from "node:path";
import { siteConfig } from "./site-config.mjs";

const root = process.cwd();
const sitemapFile = path.join(root, "sitemap.xml");
const redirectsFile = path.join(root, "_redirects");
const postsJsonPath = path.join(root, "data", "posts.json");

function fail(msg) {
  console.error(`❌ CHECK FAILED: ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`✅ ${msg}`);
}

function findHtmlFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "scripts") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) findHtmlFiles(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(fullPath);
  }
  return files;
}

function isNoindex(html) {
  return /<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*(?:noindex|none)/i.test(html);
}

function readRedirectUrls() {
  if (!fs.existsSync(redirectsFile)) return [];
  const lines = fs.readFileSync(redirectsFile, "utf8").split("\n");
  const urls = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts[0]) urls.push(parts[0]);
  }
  return urls;
}

const htmlFiles = findHtmlFiles(root);
const redirectUrls = readRedirectUrls();
const isPreviewValidation = process.argv.includes("--preview") ||
  process.env.IS_PREVIEW === "true" ||
  ["deploy-preview", "branch-deploy"].includes((process.env.CONTEXT || "").trim().toLowerCase());

console.log("=== SEO & DYNAMIC BLOG BUILD VALIDATION ===");

// 1. VALID XML & SITEMAP VALIDATION
if (!fs.existsSync(sitemapFile)) {
  fail("sitemap.xml does not exist");
}

const sitemapXml = fs.readFileSync(sitemapFile, "utf8");

if (!sitemapXml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
  fail("sitemap.xml missing XML declaration");
}

if (!sitemapXml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">') || !sitemapXml.includes("</urlset>")) {
  fail("sitemap.xml missing or malformed <urlset> tags");
}

// Extract all <url> blocks
const urlBlocks = sitemapXml.match(/<url>[\s\S]*?<\/url>/g) || [];
if (urlBlocks.length === 0) {
  if (isPreviewValidation) {
    pass("Preview sitemap contains 0 public URL entries as expected to prevent search crawler indexing");
    console.log("\n🎉 ALL PREVIEW STAGING VALIDATIONS PASSED!");
    process.exit(0);
  }
  fail("sitemap.xml contains no <url> entries");
}

const sitemapUrls = [];

if (isPreviewValidation) {
  pass("Preview staging validation active: confirming all preview pages are protected with NOINDEX");
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    if (!isNoindex(html)) {
      fail(`Preview staging protection failed: Page ${path.relative(root, file)} is missing noindex meta tag!`);
    }
  }
  pass(`Preview staging protection verified: All ${htmlFiles.length} pages are guarded with NOINDEX`);
}
for (const block of urlBlocks) {
  const locMatch = block.match(/<loc>(.*?)<\/loc>/);
  const lastmodMatch = block.match(/<lastmod>(.*?)<\/lastmod>/);
  const changefreqMatch = block.match(/<changefreq>(.*?)<\/changefreq>/);
  const priorityMatch = block.match(/<priority>(.*?)<\/priority>/);

  if (!locMatch || !locMatch[1].trim()) fail(`Malformed <url> entry (missing <loc>):\n${block}`);
  if (!lastmodMatch || !lastmodMatch[1].trim()) fail(`Malformed <url> entry (missing <lastmod>):\n${block}`);
  if (!changefreqMatch || !changefreqMatch[1].trim()) fail(`Malformed <url> entry (missing <changefreq>):\n${block}`);
  if (!priorityMatch || !priorityMatch[1].trim()) fail(`Malformed <url> entry (missing <priority>):\n${block}`);

  const loc = locMatch[1].trim();
  const lastmod = lastmodMatch[1].trim();
  const changefreq = changefreqMatch[1].trim();
  const priority = priorityMatch[1].trim();

  // Validate lastmod format YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) {
    fail(`Invalid lastmod format '${lastmod}' in sitemap for ${loc}`);
  }

  // Validate changefreq
  const validFreqs = ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"];
  if (!validFreqs.includes(changefreq)) {
    fail(`Invalid changefreq '${changefreq}' in sitemap for ${loc}`);
  }

  // Validate priority
  const prioNum = parseFloat(priority);
  if (isNaN(prioNum) || prioNum < 0.0 || prioNum > 1.0) {
    fail(`Invalid priority '${priority}' in sitemap for ${loc}`);
  }

  // Check XML entities
  if (/[<>&"']/.test(loc.replace(/&(?:amp|lt|gt|quot|apos);/g, ""))) {
    fail(`Unescaped XML character in sitemap loc: ${loc}`);
  }

  sitemapUrls.push(loc);
}
pass(`Valid XML: sitemap.xml parsed successfully with ${sitemapUrls.length} entries`);

// 2. NO DUPLICATE URLS
const uniqueSitemapUrls = new Set(sitemapUrls);
if (uniqueSitemapUrls.size !== sitemapUrls.length) {
  const duplicates = sitemapUrls.filter((url, i) => sitemapUrls.indexOf(url) !== i);
  fail(`Duplicate URLs found in sitemap.xml: ${duplicates.join(", ")}`);
}
pass("No duplicate URLs in sitemap.xml");

// 3. EXCLUDE 404 AND NOINDEX PAGES FROM SITEMAP
for (const loc of sitemapUrls) {
  if (loc.includes("404") || loc.endsWith("404.html")) {
    fail(`404.html must not be in sitemap.xml (found: ${loc})`);
  }
  if (loc.includes("thank-you") || loc.endsWith("thank-you.html")) {
    fail(`thank-you.html has noindex and must not be in sitemap.xml (found: ${loc})`);
  }
  if (loc.includes("pay.html") || loc.endsWith("/pay")) {
    fail(`pay.html has noindex and must not be in sitemap.xml (found: ${loc})`);
  }
}

// 4. AVOID ADDING REDIRECT-ONLY URLS
for (const redirectPath of redirectUrls) {
  const redirectFullUrl = `${siteConfig.productionUrl}${redirectPath}`;
  if (sitemapUrls.includes(redirectFullUrl)) {
    fail(`Redirect-only URL '${redirectFullUrl}' found in sitemap.xml!`);
  }
}
pass("Sitemap contains only canonical, indexable URLs and no redirect-only URLs");

// 5. DYNAMIC BLOG AND DRAFT SAFETY CHECKS
if (fs.existsSync(postsJsonPath)) {
  const allPosts = JSON.parse(fs.readFileSync(postsJsonPath, "utf8"));
  const publishedPosts = allPosts.filter((p) => p.status === "published");
  const draftPosts = allPosts.filter((p) => p.status === "draft" || p.status === "archived");

  const blogHtmlContent = fs.readFileSync(path.join(root, "blog.html"), "utf8");

  // Check 5.1: Every published post exists as a server-rendered HTML file
  for (const post of publishedPosts) {
    const postFilePath = path.join(root, "blog", `${post.slug}.html`);
    if (!fs.existsSync(postFilePath)) {
      fail(`Published post missing HTML file: blog/${post.slug}.html`);
    }

    const postHtml = fs.readFileSync(postFilePath, "utf8");
    if (!postHtml.includes('<article class="blog-post">')) {
      fail(`Published post blog/${post.slug}.html is missing server-rendered article container`);
    }

    // Google can read article content without JavaScript
    const postTextSnippet = post.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
    const htmlText = postHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (!htmlText.includes(postTextSnippet)) {
      fail(`Server-rendered HTML in blog/${post.slug}.html does not contain article content`);
    }

    // Must be in sitemap
    const expectedLoc = post.canonical_url || `${siteConfig.productionUrl}/blog/${post.slug}.html`;
    if (!sitemapUrls.includes(expectedLoc)) {
      fail(`Published post '${expectedLoc}' missing from sitemap.xml`);
    }

    // Must appear in blog index
    if (!blogHtmlContent.includes(`blog/${post.slug}.html`)) {
      fail(`Published post '${post.slug}' missing from blog.html index`);
    }
  }
  pass(`Published blog content (${publishedPosts.length} posts) is fully server-rendered and listed in sitemap & blog index`);

  // Check 5.2: Draft content never appears publicly
  for (const draft of draftPosts) {
    const draftFilePath = path.join(root, "blog", `${draft.slug}.html`);
    if (fs.existsSync(draftFilePath)) {
      fail(`Draft post file '${draftFilePath}' must NOT exist publicly!`);
    }

    const draftLoc = `${siteConfig.productionUrl}/blog/${draft.slug}.html`;
    if (sitemapUrls.includes(draftLoc)) {
      fail(`Draft post '${draftLoc}' found in sitemap.xml! Draft content must never appear in sitemap.`);
    }

    if (blogHtmlContent.includes(`blog/${draft.slug}.html`)) {
      fail(`Draft post '${draft.slug}' linked in blog.html index! Draft content must never appear publicly.`);
    }
  }
  pass(`Draft content safety: ${draftPosts.length} draft/archived post(s) successfully prevented from appearing publicly`);
}

// 6. PER-PAGE VALIDATIONS ACROSS ALL HTML FILES
for (const filePath of htmlFiles) {
  const relPath = path.relative(root, filePath).split(path.sep).join("/");
  const html = fs.readFileSync(filePath, "utf8");
  const noindex = isNoindex(html) || relPath === "404.html";

  // Check 6.1: Exactly one title per page
  const titleMatches = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/gi) || [];
  if (titleMatches.length !== 1) {
    fail(`Expected exactly 1 <title> in ${relPath}, found ${titleMatches.length}`);
  }
  const titleText = titleMatches[0].replace(/<[^>]+>/g, "").trim();
  if (!titleText) {
    fail(`Empty <title> tag in ${relPath}`);
  }

  // Check 6.2: Exactly one meta description per indexable page
  const descMatches = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/gi) || [];
  if (!noindex) {
    if (descMatches.length !== 1) {
      fail(`Expected exactly 1 meta description in indexable page ${relPath}, found ${descMatches.length}`);
    }
    const descContent = descMatches[0].match(/content=["']([^"']*)["']/i)?.[1]?.trim();
    if (!descContent) {
      fail(`Empty meta description in indexable page ${relPath}`);
    }
  }

  // Check 6.3: Canonical URL check
  const canonicalMatches = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/gi) || [];
  if (!noindex || relPath === "pay.html") {
    if (canonicalMatches.length !== 1) {
      fail(`Expected exactly 1 canonical URL in ${relPath}, found ${canonicalMatches.length}`);
    }
    const href = canonicalMatches[0].match(/href=["']([^"']*)["']/i)?.[1];
    if (!href || !href.startsWith(siteConfig.productionUrl)) {
      fail(`Invalid canonical URL '${href}' in ${relPath}`);
    }

    // Check that canonical URL does not point to a missing file
    const urlPath = href.replace(siteConfig.productionUrl, "");
    let expectedFile = urlPath === "/" || urlPath === "" ? "index.html" : urlPath.replace(/^\//, "");
    if (!fs.existsSync(path.join(root, expectedFile))) {
      fail(`Broken canonical URL: '${href}' in ${relPath} points to non-existent file '${expectedFile}'`);
    }

    // Check that canonical URL is not a redirect-only URL
    if (redirectUrls.includes(urlPath)) {
      fail(`Broken canonical URL: '${href}' in ${relPath} is a redirect-only path`);
    }
  }

  // Check 6.4: Valid JSON-LD syntax and page-specific schema verification
  const ldJsonMatches = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];

  if (relPath === "404.html") {
    // 404 page should have no schema
    if (ldJsonMatches.length > 0) {
      fail(`404.html should not have JSON-LD schema (found ${ldJsonMatches.length})`);
    }
  } else if (relPath !== "thank-you.html") {
    if (ldJsonMatches.length !== 1) {
      fail(`Expected exactly 1 JSON-LD block in ${relPath}, found ${ldJsonMatches.length}`);
    }

    const jsonContent = ldJsonMatches[0].replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>/i, "").replace(/<\/script>/i, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonContent);
    } catch (e) {
      fail(`Invalid JSON-LD syntax in ${relPath}: ${e.message}`);
    }

    if (parsed["@context"] !== "https://schema.org") {
      fail(`JSON-LD @context must be 'https://schema.org' in ${relPath}`);
    }

    const types = (parsed["@graph"] || []).map((node) => node["@type"]).flat();

    // Verify required schema types per page according to spec:
    if (relPath === "index.html") {
      if (!types.includes("WebSite") || !types.includes("Organization") || !types.includes("ProfessionalService")) {
        fail(`index.html missing required schema types (expected WebSite, Organization, ProfessionalService; found: ${types.join(", ")})`);
      }
    } else if (relPath === "services.html") {
      const hasOffer = parsed["@graph"].some((node) => node.offers?.["@type"] === "Offer" || node["@type"] === "Offer");
      if (!types.includes("CollectionPage") || !types.includes("Service") || !hasOffer) {
        fail(`services.html missing required schema types (expected CollectionPage, Service, Offer; found: ${types.join(", ")})`);
      }
    } else if (relPath === "about.html") {
      if (!types.includes("AboutPage") || !types.includes("Person")) {
        fail(`about.html missing required schema types (expected AboutPage, Person; found: ${types.join(", ")})`);
      }
    } else if (relPath === "contact.html") {
      if (!types.includes("ContactPage") || !types.includes("ContactPoint")) {
        fail(`contact.html missing required schema types (expected ContactPage, ContactPoint; found: ${types.join(", ")})`);
      }
    } else if (relPath === "blog.html") {
      if (!types.includes("Blog") || !types.includes("CollectionPage")) {
        fail(`blog.html missing required schema types (expected Blog, CollectionPage; found: ${types.join(", ")})`);
      }
    } else if (relPath.startsWith("blog/")) {
      if (!types.includes("BlogPosting") || !types.includes("BreadcrumbList")) {
        fail(`${relPath} missing required schema types (expected BlogPosting, BreadcrumbList; found: ${types.join(", ")})`);
      }

      // Check all 10 blog post properties
      const blogPosting = parsed["@graph"].find((node) => node["@type"] === "BlogPosting");
      const breadcrumbList = parsed["@graph"].find((node) => node["@type"] === "BreadcrumbList");

      if (!blogPosting.headline && !blogPosting.name) fail(`${relPath} BlogPosting missing title`);
      if (!blogPosting.description) fail(`${relPath} BlogPosting missing description`);
      if (!blogPosting.author) fail(`${relPath} BlogPosting missing author`);
      if (!blogPosting.datePublished) fail(`${relPath} BlogPosting missing datePublished`);
      if (!blogPosting.dateModified) fail(`${relPath} BlogPosting missing dateModified`);
      if (!blogPosting.image) fail(`${relPath} BlogPosting missing image`);
      if (!blogPosting.url) fail(`${relPath} BlogPosting missing canonical URL`);
      if (!blogPosting.articleSection) fail(`${relPath} BlogPosting missing articleSection`);
      if (!blogPosting.keywords) fail(`${relPath} BlogPosting missing keywords`);
      if (!breadcrumbList.itemListElement || breadcrumbList.itemListElement.length < 3) fail(`${relPath} BreadcrumbList missing breadcrumb path`);
    } else if (relPath === "pay.html" || relPath === "privacy.html" || relPath === "terms.html" || relPath === "refund.html") {
      if (!types.includes("WebPage")) {
        fail(`${relPath} missing WebPage schema (found: ${types.join(", ")})`);
      }
    }
  }

  // Check 6.5: Integrations preserved (GA4, GTM, PostHog)
  if (!html.includes(siteConfig.integrations.ga4Id)) {
    fail(`Accidental removal of GA4 (${siteConfig.integrations.ga4Id}) in ${relPath}`);
  }
  if (!html.includes(siteConfig.integrations.gtmId)) {
    fail(`Accidental removal of GTM (${siteConfig.integrations.gtmId}) in ${relPath}`);
  }
  if (!html.includes("posthog-init.js") && !html.includes("posthog")) {
    fail(`Accidental removal of PostHog in ${relPath}`);
  }
}

pass("All HTML pages contain exactly 1 title");
pass("All indexable HTML pages contain exactly 1 meta description");
pass("All indexable HTML pages have valid, verified canonical URLs");
pass("All pages have valid JSON-LD schemas matching specification");
pass("All integrations (GA4, GTM, PostHog) are fully preserved across all pages");

console.log("\n🎉 ALL BUILD & DYNAMIC SEO VALIDATIONS PASSED!");
process.exit(0);
