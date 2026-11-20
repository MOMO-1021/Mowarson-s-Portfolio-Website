import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const baseUrl = "https://mowarsondeveloper.netlify.app";
const outputFile = path.join(root, "sitemap.xml");

const pageConfig = {
  "index.html": { priority: "1.0", changefreq: "weekly", type: "WebPage" },
  "services.html": { priority: "0.95", changefreq: "monthly", type: "CollectionPage" },
  "about.html": { priority: "0.85", changefreq: "monthly", type: "AboutPage" },
  "contact.html": { priority: "0.85", changefreq: "monthly", type: "ContactPage" },
  "blog.html": { priority: "0.85", changefreq: "weekly", type: "Blog" },
  "privacy.html": { priority: "0.3", changefreq: "yearly", type: "WebPage" },
  "terms.html": { priority: "0.3", changefreq: "yearly", type: "WebPage" },
  "refund.html": { priority: "0.3", changefreq: "yearly", type: "WebPage" },
  "pay.html": { priority: "0.3", changefreq: "monthly", type: "WebPage" }
};

const organization = {
  "@type": "Organization",
  "@id": `${baseUrl}/#organization`,
  "name": "Mowarson Developer",
  "url": baseUrl,
  "logo": {
    "@type": "ImageObject",
    "url": `${baseUrl}/assets/favicon.png`
  },
  "email": "mowarsondeveloper@gmail.com",
  "telephone": "+916009825938",
  "sameAs": [
    "https://www.linkedin.com/in/mowarson-developer-298404302/",
    "https://www.instagram.com/mowarson_developer/",
    "https://www.facebook.com/profile.php?id=61596554436022",
    "https://x.com/MowarsonDev",
    "https://www.threads.com/@mowarson_developer"
  ]
};

function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function readMatch(html, regex, fallback) {
  const match = html.match(regex);
  return match ? match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : fallback;
}

function localPath(relativePath) {
  return path.join(root, relativePath);
}

function relativeUrl(filePath) {
  return filePath.split(path.sep).join("/");
}

function isNoindex(html) {
  return /<meta\s+[^>]*name=["']robots["'][^>]*content=["'][^"']*(?:noindex|none)/i.test(html);
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

function pageSchema(relativePath, html) {
  const url = relativePath === "index.html" ? `${baseUrl}/` : `${baseUrl}/${relativePath}`;
  const title = readMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i, relativePath);
  const description = readMatch(html, /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i, "");
  const config = pageConfig[relativePath] || {
    priority: relativePath.startsWith("blog/") ? "0.7" : "0.5",
    changefreq: relativePath.startsWith("blog/") ? "monthly" : "yearly",
    type: relativePath.startsWith("blog/") ? "BlogPosting" : "WebPage"
  };

  const page = {
    "@type": config.type,
    "@id": `${url}#page`,
    "url": url,
    "name": title,
    "headline": title,
    "description": description,
    "inLanguage": "en-IN",
    "isPartOf": { "@id": `${baseUrl}/#website` },
    "publisher": { "@id": `${baseUrl}/#organization` }
  };

  if (config.type === "BlogPosting") {
    page.author = { "@type": "Person", "name": "Mowarson" };
  }

  const graph = [
    organization,
    {
      "@type": "WebSite",
      "@id": `${baseUrl}/#website`,
      "url": baseUrl,
      "name": "Mowarson Developer",
      "inLanguage": "en-IN",
      "publisher": { "@id": `${baseUrl}/#organization` }
    },
    page
  ];

  if (relativePath === "index.html") {
    graph.push({
      "@type": "ProfessionalService",
      "@id": `${baseUrl}/#professional-service`,
      "name": "Mowarson Developer",
      "url": baseUrl,
      "provider": { "@id": `${baseUrl}/#organization` },
      "areaServed": { "@type": "Country", "name": "India" },
      "priceRange": "₹4000 - ₹5000",
      "serviceType": ["Brand Positioning", "Brand Messaging", "SEO-Optimized Website Design"]
    });
  }

  if (relativePath === "about.html") {
    graph.push({
      "@type": "Person",
      "@id": `${baseUrl}/about.html#person`,
      "name": "Mowarson",
      "url": `${baseUrl}/about.html`,
      "jobTitle": "Brand Marketing Specialist",
      "knowsAbout": ["Brand Positioning", "Brand Messaging", "SEO-Optimized Website Design"],
      "worksFor": { "@id": `${baseUrl}/#organization` }
    });
  }

  if (relativePath === "contact.html") {
    graph.push({
      "@type": "ContactPoint",
      "@id": `${baseUrl}/contact.html#contact`,
      "telephone": "+916009825938",
      "email": "mowarsondeveloper@gmail.com",
      "contactType": "customer service",
      "areaServed": { "@type": "Country", "name": "India" }
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

function updateHtml(relativePath, filePath) {
  let html = fs.readFileSync(filePath, "utf8");
  html = html.replace(/<script[^>]*>[\s\S]*?G-S7P05N251P[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<script[^>]*src=["']https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-S7P05N251P["'][^>]*><\/script>/gi, "");
  const analyticsBootstrap = `    <!-- Google Analytics 4 with consent mode -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-S7P05N251P"></script>
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
      gtag("config", "G-S7P05N251P", {
        send_page_view: true,
        linker: {
          domains: ["mowarsondeveloper-blog-website.netlify.app"]
        }
      });
    </script>
`;
  html = html.replace(/<head([^>]*)>/i, (match) => `${match}\n${analyticsBootstrap}`);

  const socialLinks = [
    '<a href="https://www.facebook.com/profile.php?id=61596554436022" target="_blank" rel="noopener noreferrer">Facebook</a>',
    '<a href="https://x.com/MowarsonDev" target="_blank" rel="noopener noreferrer">X</a>',
    '<a href="https://www.threads.com/@mowarson_developer" target="_blank" rel="noopener noreferrer">Threads</a>',
    '<a href="https://www.instagram.com/mowarson_developer/" target="_blank" rel="noopener noreferrer">Instagram</a>',
    '<a href="https://www.linkedin.com/in/mowarson-developer-298404302/" target="_blank" rel="noopener noreferrer">LinkedIn</a>'
  ].join("");
  const footerBlock = `\n      <div class="footer-links">${socialLinks}</div>\n`;

  const inBlogFolder = relativePath.startsWith("blog/");
  const prefix = inBlogFolder ? "../" : "";
  const footerMarkup = [
    "  <footer>",
    '    <div class="container">',
    '      <p>&copy; 2026 Mowarson Developer. All rights reserved.</p>',
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
    html = html.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, footerMarkup);
  } else {
    html = html.replace(/<\/body>/i, `\n${footerMarkup}\n</body>`);
  }

  if (!/posthog-init\.js/.test(html)) {
    html = html.replace(/<script\b[^>]*src=["'][^"']*script\.js["'][^>]*><\/script>/i,
      '<script src="/posthog-init.js"></script>\n    $&');
  }

  html = html.replace(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, "");
  const json = JSON.stringify(pageSchema(relativePath, html), null, 2);
  const ldJson = `    <script type="application/ld+json">\n${json.split("\n").map((line) => `    ${line}`).join("\n")}\n    </script>\n`;
  html = html.replace("</head>", `${ldJson}  </head>`);
  fs.writeFileSync(filePath, html);
  return html;
}

const htmlFiles = findHtmlFiles(root);
const sitemapEntries = [];

for (const filePath of htmlFiles) {
  const relativePath = relativeUrl(path.relative(root, filePath));
  const html = updateHtml(relativePath, filePath);
  if (relativePath === "404.html" || isNoindex(html)) continue;

  const config = pageConfig[relativePath] || {
    priority: relativePath.startsWith("blog/") ? "0.7" : "0.5",
    changefreq: relativePath.startsWith("blog/") ? "monthly" : "yearly"
  };
  const stat = fs.statSync(filePath);
  const lastmod = stat.mtime.toISOString().slice(0, 10);
  const loc = relativePath === "index.html" ? `${baseUrl}/` : `${baseUrl}/${relativePath}`;
  sitemapEntries.push({ loc, lastmod, changefreq: config.changefreq, priority: config.priority });
}

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

fs.writeFileSync(outputFile, sitemap);
console.log(`Generated sitemap.xml with ${sitemapEntries.length} indexed pages and updated JSON-LD for ${htmlFiles.length} HTML pages.`);
