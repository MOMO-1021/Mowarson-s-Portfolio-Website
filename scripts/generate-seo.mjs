import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { siteConfig } from "./site-config.mjs";

const root = process.cwd();
const outputFile = path.join(root, "sitemap.xml");
const postsJsonPath = path.join(root, "data", "posts.json");

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function readMatch(html, regex, fallback = "") {
  const match = html.match(regex);
  return match ? match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : fallback;
}

function relativeUrl(filePath) {
  return filePath.split(path.sep).join("/");
}

function isNoindex(html) {
  return /<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*(?:noindex|none)/i.test(html);
}

const isPreviewBuild = process.argv.includes("--preview") ||
  process.env.IS_PREVIEW === "true" ||
  ["deploy-preview", "branch-deploy"].includes((process.env.CONTEXT || "").trim().toLowerCase());

function getBlogPostsMap() {
  const map = { ...siteConfig.blogPosts };
  if (fs.existsSync(postsJsonPath)) {
    try {
      const posts = JSON.parse(fs.readFileSync(postsJsonPath, "utf8"));
      for (const p of posts) {
        if (p.status === "published") {
          const key = `blog/${p.slug}.html`;
          map[key] = {
            title: p.title,
            description: p.description,
            author: p.author || "Mowarson",
            datePublished: p.published_at ? p.published_at.slice(0, 10) : (map[key]?.datePublished || "2026-03-25"),
            dateModified: p.updated_at ? p.updated_at.slice(0, 10) : (map[key]?.dateModified || "2026-11-22"),
            image: p.featured_image || map[key]?.image || siteConfig.defaultImage,
            canonical: p.canonical_url || `${siteConfig.productionUrl}/blog/${p.slug}.html`,
            articleSection: p.articleSection || map[key]?.articleSection || "Brand Positioning & Marketing",
            keywords: p.keywords || map[key]?.keywords || ["Brand Positioning", "Web Design"],
            breadcrumbName: p.breadcrumbName || map[key]?.breadcrumbName || p.title.split("–")[0].trim(),
            priority: "0.7",
            changefreq: "monthly"
          };
        }
      }
    } catch (e) {
      // Ignore parse errors, fallback to siteConfig
    }
  }
  return map;
}

function readExistingSitemapDates(sitemapPath) {
  const dates = {};
  if (!fs.existsSync(sitemapPath)) return dates;
  try {
    const xml = fs.readFileSync(sitemapPath, "utf8");
    const locRegex = /<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g;
    let match;
    while ((match = locRegex.exec(xml)) !== null) {
      const loc = match[1].trim();
      const lastmod = match[2].trim();
      dates[loc] = lastmod;
    }
  } catch {
    // Ignore error
  }
  return dates;
}

function getRealLastModifiedDate(filePath, relativePath, existingSitemapDates = {}) {
  const blogPostsMap = getBlogPostsMap();
  const canonical = siteConfig.pages[relativePath]?.canonical ||
    blogPostsMap[relativePath]?.canonical ||
    (relativePath === "index.html" ? `${siteConfig.productionUrl}/` : `${siteConfig.productionUrl}/${relativePath}`);

  // 1. Try git log for exact commit date
  try {
    const gitDate = execSync(`git log -1 --format=%as -- "${filePath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(gitDate)) {
      return gitDate;
    }
  } catch {
    // Git unavailable
  }

  // 2. Check blog post map definition
  if (blogPostsMap[relativePath]?.dateModified) {
    return blogPostsMap[relativePath].dateModified;
  }

  // 3. Fallback to existing sitemap date if available
  if (existingSitemapDates[canonical]) {
    return existingSitemapDates[canonical];
  }

  // 4. File stat mtime fallback
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
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

function extractBlogData(relativePath, html, filePath, existingSitemapDates) {
  const blogPostsMap = getBlogPostsMap();
  const config = blogPostsMap[relativePath] || siteConfig.blogPosts[relativePath] || {};
  const title = config.title || readMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i, relativePath);
  const description = config.description || readMatch(html, /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i, "");
  const canonical = config.canonical || `${siteConfig.productionUrl}/${relativePath}`;
  const author = config.author || "Mowarson";
  const datePublished = config.datePublished || "2026-03-25";
  const dateModified = getRealLastModifiedDate(filePath, relativePath, existingSitemapDates) || config.dateModified || datePublished;
  const image = config.image || siteConfig.defaultImage;
  const articleSection = config.articleSection || "Brand Positioning & Marketing";
  const keywords = config.keywords || ["Brand Positioning", "Web Design", "Marketing Strategy"];
  const breadcrumbName = config.breadcrumbName || readMatch(html, /aria-current=["']page["'][^>]*>([\s\S]*?)<\/span>/i, title);

  return {
    title,
    description,
    canonical,
    author,
    datePublished,
    dateModified,
    image,
    articleSection,
    keywords,
    breadcrumbName
  };
}

function buildPageSchema(relativePath, html, filePath, existingSitemapDates) {
  if (relativePath === "404.html") {
    // 404 page is noindex and receives no structured data
    return null;
  }

  const blogPostsMap = getBlogPostsMap();
  const pageCfg = siteConfig.pages[relativePath] || {};
  const canonicalUrl = pageCfg.canonical ||
    blogPostsMap[relativePath]?.canonical ||
    (relativePath === "index.html" ? `${siteConfig.productionUrl}/` : `${siteConfig.productionUrl}/${relativePath}`);

  const title = readMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i, relativePath);
  const description = readMatch(html, /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i, "");

  const organization = {
    "@type": "Organization",
    "@id": `${siteConfig.productionUrl}/#organization`,
    "name": siteConfig.organizationName,
    "url": siteConfig.productionUrl,
    "logo": {
      "@type": "ImageObject",
      "url": siteConfig.logo
    },
    "email": siteConfig.contactDetails.email,
    "telephone": siteConfig.contactDetails.telephone,
    "sameAs": siteConfig.socialProfiles
  };

  const website = {
    "@type": "WebSite",
    "@id": `${siteConfig.productionUrl}/#website`,
    "url": siteConfig.productionUrl,
    "name": siteConfig.siteName,
    "inLanguage": siteConfig.defaultLanguage,
    "publisher": { "@id": `${siteConfig.productionUrl}/#organization` }
  };

  const graph = [organization, website];

  // Homepage: WebSite, Organization, ProfessionalService
  if (relativePath === "index.html") {
    graph.push({
      "@type": "ProfessionalService",
      "@id": `${siteConfig.productionUrl}/#professional-service`,
      "name": siteConfig.organizationName,
      "url": siteConfig.productionUrl,
      "provider": { "@id": `${siteConfig.productionUrl}/#organization` },
      "areaServed": { "@type": "Country", "name": siteConfig.contactDetails.areaServed },
      "priceRange": "₹5000 - ₹7000",
      "serviceType": ["Brand Positioning", "Brand Messaging", "SEO-Optimized Website Design"]
    });
    graph.push({
      "@type": "WebPage",
      "@id": `${canonicalUrl}#page`,
      "url": canonicalUrl,
      "name": title,
      "headline": title,
      "description": description,
      "inLanguage": siteConfig.defaultLanguage,
      "isPartOf": { "@id": `${siteConfig.productionUrl}/#website` },
      "publisher": { "@id": `${siteConfig.productionUrl}/#organization` }
    });
  }

  // Services: CollectionPage, Service, Offer
  else if (relativePath === "services.html") {
    graph.push({
      "@type": "CollectionPage",
      "@id": `${canonicalUrl}#page`,
      "url": canonicalUrl,
      "name": title,
      "headline": title,
      "description": description,
      "inLanguage": siteConfig.defaultLanguage,
      "isPartOf": { "@id": `${siteConfig.productionUrl}/#website` },
      "publisher": { "@id": `${siteConfig.productionUrl}/#organization` }
    });

    for (const s of siteConfig.services) {
      graph.push({
        "@type": "Service",
        "@id": `${canonicalUrl}#${s.id}`,
        "name": s.name,
        "description": s.description,
        "provider": { "@id": `${siteConfig.productionUrl}/#organization` },
        "areaServed": { "@type": "Country", "name": siteConfig.contactDetails.areaServed },
        "offers": {
          "@type": "Offer",
          "price": s.price,
          "priceCurrency": s.priceCurrency,
          "url": s.url,
          "availability": "https://schema.org/InStock"
        }
      });
    }
  }

  // About: AboutPage, Person
  else if (relativePath === "about.html") {
    graph.push({
      "@type": "AboutPage",
      "@id": `${canonicalUrl}#page`,
      "url": canonicalUrl,
      "name": title,
      "headline": title,
      "description": description,
      "inLanguage": siteConfig.defaultLanguage,
      "isPartOf": { "@id": `${siteConfig.productionUrl}/#website` },
      "publisher": { "@id": `${siteConfig.productionUrl}/#organization` },
      "mainEntity": { "@id": `${canonicalUrl}#person` }
    });
    graph.push({
      "@type": "Person",
      "@id": `${canonicalUrl}#person`,
      "name": "Mowarson",
      "url": canonicalUrl,
      "image": siteConfig.defaultImage,
      "jobTitle": "Brand Marketing Specialist",
      "knowsAbout": ["Brand Positioning", "Brand Messaging", "SEO-Optimized Website Design"],
      "worksFor": { "@id": `${siteConfig.productionUrl}/#organization` }
    });
  }

  // Contact: ContactPage, ContactPoint
  else if (relativePath === "contact.html") {
    graph.push({
      "@type": "ContactPage",
      "@id": `${canonicalUrl}#page`,
      "url": canonicalUrl,
      "name": title,
      "headline": title,
      "description": description,
      "inLanguage": siteConfig.defaultLanguage,
      "isPartOf": { "@id": `${siteConfig.productionUrl}/#website` },
      "publisher": { "@id": `${siteConfig.productionUrl}/#organization` },
      "mainEntity": { "@id": `${canonicalUrl}#contact` }
    });
    graph.push({
      "@type": "ContactPoint",
      "@id": `${canonicalUrl}#contact`,
      "telephone": siteConfig.contactDetails.telephone,
      "email": siteConfig.contactDetails.email,
      "contactType": siteConfig.contactDetails.contactType,
      "areaServed": { "@type": "Country", "name": siteConfig.contactDetails.areaServed }
    });
  }

  // Blog Index: Blog, CollectionPage
  else if (relativePath === "blog.html") {
    graph.push({
      "@type": "CollectionPage",
      "@id": `${canonicalUrl}#page`,
      "url": canonicalUrl,
      "name": title,
      "headline": title,
      "description": description,
      "inLanguage": siteConfig.defaultLanguage,
      "isPartOf": { "@id": `${siteConfig.productionUrl}/#website` },
      "publisher": { "@id": `${siteConfig.productionUrl}/#organization` },
      "mainEntity": { "@id": `${canonicalUrl}#blog` }
    });
    graph.push({
      "@type": "Blog",
      "@id": `${canonicalUrl}#blog`,
      "url": canonicalUrl,
      "name": "Mowarson Developer Blog & Strategic Resources",
      "description": description,
      "inLanguage": siteConfig.defaultLanguage,
      "publisher": { "@id": `${siteConfig.productionUrl}/#organization` }
    });
  }

  // Blog Article: BlogPosting, BreadcrumbList
  else if (relativePath.startsWith("blog/")) {
    const blogData = extractBlogData(relativePath, html, filePath, existingSitemapDates);

    graph.push({
      "@type": "BlogPosting",
      "@id": `${blogData.canonical}#article`,
      "isPartOf": { "@id": `${siteConfig.productionUrl}/#website` },
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": blogData.canonical
      },
      "headline": blogData.title,
      "name": blogData.title,
      "description": blogData.description,
      "inLanguage": siteConfig.defaultLanguage,
      "url": blogData.canonical,
      "publisher": { "@id": `${siteConfig.productionUrl}/#organization` },
      "author": {
        "@type": "Person",
        "name": blogData.author,
        "url": `${siteConfig.productionUrl}/about.html`
      },
      "datePublished": blogData.datePublished,
      "dateModified": blogData.dateModified,
      "image": blogData.image,
      "articleSection": blogData.articleSection,
      "keywords": Array.isArray(blogData.keywords) ? blogData.keywords.join(", ") : blogData.keywords
    });

    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${blogData.canonical}#breadcrumb`,
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "Home",
          "item": `${siteConfig.productionUrl}/`
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "Blog",
          "item": `${siteConfig.productionUrl}/blog.html`
        },
        {
          "@type": "ListItem",
          "position": 3,
          "name": blogData.breadcrumbName,
          "item": blogData.canonical
        }
      ]
    });
  }

  // Legal / Pay / Default: WebPage
  else {
    graph.push({
      "@type": "WebPage",
      "@id": `${canonicalUrl}#page`,
      "url": canonicalUrl,
      "name": title,
      "headline": title,
      "description": description,
      "inLanguage": siteConfig.defaultLanguage,
      "isPartOf": { "@id": `${siteConfig.productionUrl}/#website` },
      "publisher": { "@id": `${siteConfig.productionUrl}/#organization` }
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

function updateHtml(relativePath, filePath, existingSitemapDates) {
  let html = fs.readFileSync(filePath, "utf8");
  const originalHtml = html;

  // 1. Clean up old GA4 scripts and orphan comments
  html = html.replace(/(?:[ \t]*<!-- Google Analytics 4 with consent mode -->\s*)+/gi, "");
  html = html.replace(/(?:[ \t]*<!-- Google tag \(gtag\.js\) -->\s*)+/gi, "");
  html = html.replace(/<script[^>]*src=["']https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[^"']+["'][^>]*><\/script>\s*/gi, "");
  html = html.replace(/<script[^>]*>[\s\S]*?gtag\("consent"[\s\S]*?<\/script>\s*/gi, "");

  // 2. Clean up old GTM script and orphan comments in <head>
  html = html.replace(/(?:[ \t]*<!-- Google Tag Manager -->\s*)+/gi, "");
  html = html.replace(/<!-- Google Tag Manager -->[\s\S]*?(?=<!-- Google Analytics 4|<!-- Google Tag Manager container|<\/head>)/gi, "");
  html = html.replace(/<script[^>]*>[\s\S]*?'GTM-5N6TFGZT'[\s\S]*?<\/script>\s*/gi, "");

  // Build clean unified GA4 and GTM snippet for <head>
  const analyticsBootstrap = `    <!-- Google Analytics 4 with consent mode -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${siteConfig.integrations.ga4Id}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag("consent", "default", {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
        wait_for_update: 500
      });
      gtag("js", new Date());
      gtag("config", "${siteConfig.integrations.ga4Id}", {
        send_page_view: true,
        linker: {
          domains: ["${siteConfig.integrations.blogDomain}"]
        }
      });
    </script>
`;

  const gtmBootstrap = `    <!-- Google Tag Manager -->
    <script>
      (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
      new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
      j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
      'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
      })(window,document,'script','dataLayer','${siteConfig.integrations.gtmId}');
    </script>
`;

  html = html.replace(/<head([^>]*)>\s*/i, (match, attrs) => `<head${attrs}>\n${analyticsBootstrap}${gtmBootstrap}`);

  // 3. Clean up and ensure GTM noscript in <body>
  html = html.replace(/(?:[ \t]*<!-- Google Tag Manager \(noscript\) -->\s*)+<noscript>[\s\S]*?GTM-5N6TFGZT[\s\S]*?<\/noscript>\s*/gi, "");
  const gtmNoscript = `    <!-- Google Tag Manager (noscript) -->
    <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${siteConfig.integrations.gtmId}"
    height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
`;
  html = html.replace(/<body([^>]*)>\s*/i, (match, attrs) => `<body${attrs}>\n${gtmNoscript}`);

  // 4. Ensure PostHog script is present before script.js
  if (!/posthog-init\.js/.test(html)) {
    html = html.replace(/<script\b[^>]*src=["'][^"']*script\.js["'][^>]*><\/script>/i,
      '<script src="/posthog-init.js"></script>\n    $&');
  }

  // 5. Ensure Canonical URL tag is correct and not duplicated on indexable / designated pages
  const blogPostsMap = getBlogPostsMap();
  const pageCfg = siteConfig.pages[relativePath] || blogPostsMap[relativePath];
  const isExcluded = relativePath === "404.html" || relativePath === "thank-you.html";

  // Handle Robots Meta Tag & Preview Staging Protection (Phase 10)
  const shouldBeNoindex = isPreviewBuild || pageCfg?.noindex || relativePath === "404.html" || relativePath === "thank-you.html";
  if (shouldBeNoindex) {
    const robotsContent = (relativePath === "pay.html" && !isPreviewBuild) ? "noindex, follow" : "noindex, nofollow";
    if (/<meta\s+[^>]*name=["']robots["'][^>]*>/i.test(html)) {
      html = html.replace(/<meta\s+[^>]*name=["']robots["'][^>]*>/i, `<meta name="robots" content="${robotsContent}" />`);
    } else {
      html = html.replace("</head>", `    <meta name="robots" content="${robotsContent}" />\n  </head>`);
    }
  } else {
    // Normal production build: remove any preview or accidental noindex tags
    html = html.replace(/[ \t]*<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex[^"']*["'][^>]*>\s*/gi, "\n");
  }

  if (!isExcluded) {
    const canonicalUrl = pageCfg?.canonical ||
      (relativePath === "index.html" ? `${siteConfig.productionUrl}/` : `${siteConfig.productionUrl}/${relativePath}`);

    // Remove any existing canonical link tags
    html = html.replace(/[ \t]*<link\s+[^>]*rel=["']canonical["'][^>]*>\s*/gi, "");

    const canonicalTag = `    <link rel="canonical" href="${canonicalUrl}" />\n`;
    if (/<meta\s+[^>]*name=["']description["'][^>]*>/i.test(html)) {
      html = html.replace(/(<meta\s+[^>]*name=["']description["'][^>]*>)/i, `$1\n${canonicalTag.trimEnd()}`);
    } else {
      html = html.replace("</head>", `${canonicalTag}  </head>`);
    }
  }

  // 6. Update footer with centralized social links & legal links
  const socialLinks = siteConfig.socialProfiles.map((url) => {
    let name = "Social";
    if (url.includes("facebook")) name = "Facebook";
    else if (url.includes("x.com") || url.includes("twitter")) name = "X";
    else if (url.includes("threads")) name = "Threads";
    else if (url.includes("instagram")) name = "Instagram";
    else if (url.includes("linkedin")) name = "LinkedIn";
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>`;
  }).join("");

  const inBlogFolder = relativePath.startsWith("blog/");
  const prefix = inBlogFolder ? "../" : "";
  const footerMarkup = [
    "  <footer>",
    '    <div class="container">',
    `      <p>&copy; 2026 ${siteConfig.organizationName}. All rights reserved.</p>`,
    "      <p>",
    `        <a href="${prefix}privacy.html">Privacy Policy</a> |`,
    `        <a href="${prefix}terms.html">Terms &amp; Conditions</a> |`,
    `        <a href="${prefix}refund.html">Refund Policy</a> |`,
    `        <a href="${prefix}pay.html">Pay Online</a> |`,
    `        <a href="${prefix}contact.html">Contact</a>`,
    "      </p>",
    `      <div class="footer-links">${socialLinks}</div>`,
    "    </div>",
    "  </footer>"
  ].join("\n");

  if (/<footer\b/i.test(html)) {
    html = html.replace(/[ \t]*<footer\b[^>]*>[\s\S]*?<\/footer>/gi, footerMarkup);
  } else {
    html = html.replace(/<\/body>/i, `\n${footerMarkup}\n</body>`);
  }

  // 7. Clean up and regenerate JSON-LD schema
  html = html.replace(/[ \t]*<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, "");
  const schema = buildPageSchema(relativePath, html, filePath, existingSitemapDates);

  if (schema) {
    const json = JSON.stringify(schema, null, 2);
    const ldJson = `    <script type="application/ld+json">\n${json.split("\n").map((line) => `    ${line}`).join("\n")}\n    </script>\n`;
    html = html.replace(/[ \t]*<\/head>/i, `${ldJson}  </head>`);
  }

  // Idempotent write: write to disk ONLY if content has changed
  if (html !== originalHtml) {
    fs.writeFileSync(filePath, html, "utf8");
  }

  return html;
}

// Main Execution
const existingSitemapDates = readExistingSitemapDates(outputFile);
const blogPostsMap = getBlogPostsMap();
const htmlFiles = findHtmlFiles(root);
const sitemapEntries = [];

for (const filePath of htmlFiles) {
  const relativePath = relativeUrl(path.relative(root, filePath));

  // Exclude non-published / draft posts in blog directory
  if (relativePath.startsWith("blog/") && !blogPostsMap[relativePath]) {
    continue;
  }

  const html = updateHtml(relativePath, filePath, existingSitemapDates);

  const pageCfg = siteConfig.pages[relativePath] || {};

  // Exclude 404, thank-you, or any page with robots noindex
  if (relativePath === "404.html" || pageCfg.excludeFromSitemap || isNoindex(html)) {
    continue;
  }

  const blogCfg = blogPostsMap[relativePath];
  const priority = pageCfg.priority || blogCfg?.priority || (relativePath.startsWith("blog/") ? "0.7" : "0.5");
  const changefreq = pageCfg.changefreq || blogCfg?.changefreq || (relativePath.startsWith("blog/") ? "monthly" : "yearly");
  const lastmod = getRealLastModifiedDate(filePath, relativePath, existingSitemapDates);
  const loc = pageCfg.canonical || blogCfg?.canonical || (relativePath === "index.html" ? `${siteConfig.productionUrl}/` : `${siteConfig.productionUrl}/${relativePath}`);

  sitemapEntries.push({ loc, lastmod, changefreq, priority });
}

// Deterministic sorting: priority descending, then loc ascending
sitemapEntries.sort((a, b) => Number(b.priority) - Number(a.priority) || a.loc.localeCompare(b.loc));

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitemapEntries.map(({ loc, lastmod, changefreq, priority }) =>
    `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
  ),
  "</urlset>",
  ""
].join("\n");

const currentSitemap = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : "";
if (currentSitemap !== sitemap) {
  fs.writeFileSync(outputFile, sitemap, "utf8");
}

console.log(`Generated sitemap.xml with ${sitemapEntries.length} indexed pages and verified SEO for ${htmlFiles.length} HTML pages.`);
