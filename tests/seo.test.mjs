import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { siteConfig } from "../scripts/site-config.mjs";

const root = process.cwd();

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

// Identify indexable pages (non-noindex in production)
const nonIndexablePages = new Set(["404.html", "pay.html", "thank-you.html"]);
const indexableHtmlFiles = htmlFiles.filter((filePath) => {
  const relPath = path.relative(root, filePath).split(path.sep).join("/");
  return !nonIndexablePages.has(relPath);
});

test("SEO: Regression Testing for Every Indexable Page", async (t) => {
  assert.ok(indexableHtmlFiles.length >= 7, `Expected at least 7 indexable pages, found ${indexableHtmlFiles.length}`);

  for (const filePath of indexableHtmlFiles) {
    const relPath = path.relative(root, filePath).split(path.sep).join("/");

    await t.test(`Page: ${relPath}`, async (pt) => {
      const html = fs.readFileSync(filePath, "utf8");

      // 1. HTTP 200 response simulation: File exists, readable, and non-empty
      await pt.test("File is accessible (HTTP 200 equivalent)", () => {
        assert.ok(fs.existsSync(filePath), `File does not exist: ${filePath}`);
        assert.ok(html.length > 500, `File is unexpectedly small or empty: ${filePath}`);
      });

      // 2. Valid title
      await pt.test("Valid title (exists, length >= 15)", () => {
        const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
        assert.ok(titleMatch, `Missing title in ${relPath}`);
        const title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
        assert.ok(title.length >= 15, `Title too short (${title.length} chars) in ${relPath}: "${title}"`);
      });

      // 3. Valid description
      await pt.test("Valid description (exists, length between 30 and 300 chars)", () => {
        const descMatch = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
        assert.ok(descMatch, `Missing meta description in ${relPath}`);
        const desc = descMatch[1].trim();
        assert.ok(desc.length >= 30, `Description too short in ${relPath} (${desc.length} chars)`);
        assert.ok(desc.length <= 300, `Description too long in ${relPath} (${desc.length} chars)`);
      });

      // 4. Canonical URL
      await pt.test("Canonical URL matches expected configuration", () => {
        const canonicalMatch = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
        assert.ok(canonicalMatch, `Missing canonical link in ${relPath}`);
        const canonicalUrl = canonicalMatch[1];
        const expectedPrefix = siteConfig.productionUrl;
        assert.ok(canonicalUrl.startsWith(expectedPrefix), `Canonical URL must start with ${expectedPrefix}, got ${canonicalUrl}`);
      });

      // 5. Correct robots directive
      await pt.test("Correct robots directive (no accidental noindex on production indexable page)", () => {
        const robotsMatch = html.match(/<meta\s+[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i);
        if (robotsMatch) {
          const robotsValue = robotsMatch[1].toLowerCase();
          assert.ok(!robotsValue.includes("noindex"), `Indexable page ${relPath} must not have noindex robots directive, found: "${robotsValue}"`);
        }
      });

      // 6. JSON-LD present
      await pt.test("JSON-LD present and contains valid schema", () => {
        const ldMatches = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
        assert.ok(ldMatches.length > 0, `No JSON-LD schema found in ${relPath}`);

        for (const m of ldMatches) {
          const json = JSON.parse(m[1].trim());
          assert.ok(json["@context"] === "https://schema.org" || json["@context"] === "http://schema.org", `Invalid @context in ${relPath}`);
          assert.ok(json["@type"] || json["@graph"], `Missing @type in ${relPath}`);
        }
      });

      // 7. No broken internal links
      await pt.test("No broken internal links", () => {
        const anchorRegex = /<a\s+[^>]*href=["']([^"']*)["']/gi;
        let match;
        const brokenLinks = [];

        while ((match = anchorRegex.exec(html)) !== null) {
          const href = match[1].trim();
          // Skip external links, mailto, tel, javascript, hash-only
          if (
            !href ||
            href.startsWith("http://") ||
            href.startsWith("https://") ||
            href.startsWith("mailto:") ||
            href.startsWith("tel:") ||
            href.startsWith("javascript:") ||
            href.startsWith("#")
          ) {
            continue;
          }

          // Strip query params and hashes for file checking
          const cleanHref = href.split("?")[0].split("#")[0];
          if (!cleanHref) continue;

          const currentDir = path.dirname(filePath);
          let targetPath;
          if (cleanHref.startsWith("/")) {
            targetPath = path.join(root, cleanHref.slice(1));
          } else {
            targetPath = path.normalize(path.join(currentDir, cleanHref));
          }

          // If target is a directory or root, check index.html
          if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
            targetPath = path.join(targetPath, "index.html");
          }

          if (!fs.existsSync(targetPath)) {
            brokenLinks.push({ href, targetPath: path.relative(root, targetPath) });
          }
        }

        assert.equal(brokenLinks.length, 0, `Broken internal links in ${relPath}: ${JSON.stringify(brokenLinks, null, 2)}`);
      });
    });
  }
});
