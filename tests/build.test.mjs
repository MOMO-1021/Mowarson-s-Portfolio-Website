import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { siteConfig } from "../scripts/site-config.mjs";

const root = process.cwd();
const sitemapPath = path.join(root, "sitemap.xml");

function findHtmlFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "scripts" || entry.name === "tests") {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      findHtmlFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }
  return files;
}

const htmlFiles = findHtmlFiles(root);

test("Build: Sitemap XML Validation", async (t) => {
  await t.test("sitemap.xml exists and has valid XML declaration and root tag", () => {
    assert.ok(fs.existsSync(sitemapPath), "sitemap.xml must exist");
    const xml = fs.readFileSync(sitemapPath, "utf8");
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "XML declaration missing");
    assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), "Root urlset tag missing");
    assert.ok(xml.includes("</urlset>"), "Closing urlset tag missing");
  });

  await t.test("sitemap.xml entries have valid loc, lastmod (YYYY-MM-DD), changefreq, and priority", () => {
    const xml = fs.readFileSync(sitemapPath, "utf8");
    const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
    assert.ok(urlBlocks.length > 0, "sitemap.xml should contain url blocks");

    for (const block of urlBlocks) {
      const locMatch = block.match(/<loc>(.*?)<\/loc>/);
      const lastmodMatch = block.match(/<lastmod>(.*?)<\/lastmod>/);
      const changefreqMatch = block.match(/<changefreq>(.*?)<\/changefreq>/);
      const priorityMatch = block.match(/<priority>(.*?)<\/priority>/);

      assert.ok(locMatch, "Each url block must contain <loc>");
      assert.ok(lastmodMatch, "Each url block must contain <lastmod>");
      assert.ok(changefreqMatch, "Each url block must contain <changefreq>");
      assert.ok(priorityMatch, "Each url block must contain <priority>");

      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(lastmodMatch[1].trim()), `Invalid lastmod format: ${lastmodMatch[1]}`);
      assert.ok(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"].includes(changefreqMatch[1].trim()));
      const prio = parseFloat(priorityMatch[1].trim());
      assert.ok(!isNaN(prio) && prio >= 0 && prio <= 1.0, `Invalid priority: ${priorityMatch[1]}`);
    }
  });

  await t.test("No duplicate sitemap URLs", () => {
    const xml = fs.readFileSync(sitemapPath, "utf8");
    const locMatches = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());
    const seen = new Set();
    const duplicates = [];

    for (const loc of locMatches) {
      if (seen.has(loc)) {
        duplicates.push(loc);
      }
      seen.add(loc);
    }

    assert.equal(duplicates.length, 0, `Duplicate URLs found in sitemap: ${duplicates.join(", ")}`);
  });
});

test("Build: JSON-LD Parsing", async (t) => {
  await t.test("All JSON-LD blocks in HTML files are valid parseable JSON", () => {
    for (const file of htmlFiles) {
      const relPath = path.relative(root, file);
      const html = fs.readFileSync(file, "utf8");
      const ldJsonRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let match;
      let count = 0;

      while ((match = ldJsonRegex.exec(html)) !== null) {
        count++;
        const content = match[1].trim();
        assert.ok(content.length > 0, `Empty JSON-LD script found in ${relPath}`);
        try {
          const parsed = JSON.parse(content);
          assert.ok(parsed["@context"], `Missing @context in ${relPath}`);
          assert.ok(parsed["@type"] || parsed["@graph"], `Missing @type in ${relPath}`);
        } catch (err) {
          assert.fail(`Invalid JSON-LD syntax in ${relPath}: ${err.message}`);
        }
      }

      // Indexable pages must have at least 1 JSON-LD block (except 404)
      if (relPath !== "404.html") {
        assert.ok(count > 0, `Expected at least one JSON-LD block in ${relPath}`);
      }
    }
  });
});

test("Build: Canonical URL Validation", async (t) => {
  await t.test("All indexable HTML pages have valid, absolute canonical URLs", () => {
    for (const file of htmlFiles) {
      const relPath = path.relative(root, file);
      if (relPath === "404.html" || relPath === "thank-you.html") continue;

      const html = fs.readFileSync(file, "utf8");
      const canonicalMatch = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
      assert.ok(canonicalMatch, `Missing canonical link tag in ${relPath}`);

      const canonicalUrl = canonicalMatch[1];
      assert.ok(canonicalUrl.startsWith("https://mowarsondeveloper.netlify.app/"), `Canonical URL must be absolute and use production domain in ${relPath}`);
      assert.ok(!canonicalUrl.includes("//blog//"), `Canonical URL has duplicate slashes in ${relPath}`);
    }
  });
});

test("Build: Title & Description Validation", async (t) => {
  await t.test("Every HTML page contains exactly 1 title tag", () => {
    for (const file of htmlFiles) {
      const relPath = path.relative(root, file);
      const html = fs.readFileSync(file, "utf8");
      const titleMatches = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/gi) || [];
      assert.equal(titleMatches.length, 1, `Page ${relPath} must have exactly 1 title tag, found ${titleMatches.length}`);

      const titleText = titleMatches[0].replace(/<[^>]+>/g, "").trim();
      assert.ok(titleText.length >= 10, `Title in ${relPath} is too short (${titleText.length} chars)`);
    }
  });

  await t.test("Every indexable HTML page contains exactly 1 meta description", () => {
    for (const file of htmlFiles) {
      const relPath = path.relative(root, file);
      if (relPath === "404.html" || relPath === "thank-you.html") continue;

      const html = fs.readFileSync(file, "utf8");
      const descMatches = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/gi) || [];
      assert.equal(descMatches.length, 1, `Page ${relPath} must have exactly 1 meta description, found ${descMatches.length}`);

      const content = descMatches[0].match(/content=["']([^"']*)["']/i)[1].trim();
      assert.ok(content.length >= 30, `Meta description in ${relPath} is too short (${content.length} chars)`);
    }
  });
});

test("Build: Analytics & Integrations Preservation", async (t) => {
  await t.test("GA4, GTM, and PostHog integrations are preserved across all pages", () => {
    for (const file of htmlFiles) {
      const relPath = path.relative(root, file);
      const html = fs.readFileSync(file, "utf8");

      assert.ok(html.includes(siteConfig.integrations.ga4Id), `Missing GA4 ID (${siteConfig.integrations.ga4Id}) in ${relPath}`);
      assert.ok(html.includes(siteConfig.integrations.gtmId), `Missing GTM ID (${siteConfig.integrations.gtmId}) in ${relPath}`);
      assert.ok(html.includes("posthog-init.js") || html.includes("posthog"), `Missing PostHog initialization in ${relPath}`);
    }
  });
});
