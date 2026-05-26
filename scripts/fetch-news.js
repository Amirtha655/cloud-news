const fs = require("node:fs/promises");
const path = require("node:path");
const Parser = require("rss-parser");

const FEEDS = [
  {
    source: "AWS What's New",
    url: "https://aws.amazon.com/about-aws/whats-new/recent/feed/"
  },
  {
    source: "AWS News Blog",
    url: "https://aws.amazon.com/blogs/aws/feed/"
  },
  {
    source: "AWS Architecture Blog",
    url: "https://aws.amazon.com/blogs/architecture/feed/"
  },
  {
    source: "AWS Security Blog",
    url: "https://aws.amazon.com/blogs/security/feed/"
  }
];

const MAX_ITEMS = 30;
const parser = new Parser({ timeout: 20000 });

function normalizeUrl(input) {
  if (!input) return null;
  try {
    const url = new URL(input);
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }

    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return input.trim();
  }
}

function sanitizeText(value) {
  if (!value) return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getSummary(item) {
  const raw = item.contentSnippet || item.summary || item.content || "";
  const cleaned = sanitizeText(raw);
  if (!cleaned) return "";
  return cleaned.length > 220 ? `${cleaned.slice(0, 217).trim()}…` : cleaned;
}

function toIsoDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fetchFeed(feed) {
  const parsed = await parser.parseURL(feed.url);
  return (parsed.items || [])
    .map((item) => {
      const title = sanitizeText(item.title);
      const link = normalizeUrl(item.link);
      const pubDate = toIsoDate(item.isoDate || item.pubDate || item.updated);
      if (!title || !link || !pubDate) return null;

      return {
        title,
        link,
        source: feed.source,
        pubDate,
        summary: getSummary(item)
      };
    })
    .filter(Boolean);
}

function deduplicateByLink(items) {
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    deduped.push(item);
  }

  return deduped;
}

async function main() {
  console.log("Fetching AWS feeds...");
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));

  const merged = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const feed = FEEDS[index];

    if (result.status === "fulfilled") {
      console.log(`✓ ${feed.source}: ${result.value.length} items`);
      merged.push(...result.value);
    } else {
      console.warn(`⚠ ${feed.source}: ${result.reason?.message || "Failed to fetch"}`);
    }
  }

  if (merged.length === 0) {
    throw new Error("No feed items were fetched.");
  }

  const sorted = deduplicateByLink(merged).sort(
    (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  );

  const topItems = sorted.slice(0, MAX_ITEMS);
  const output = {
    lastUpdated: new Date().toISOString(),
    items: topItems.map(({ title, link, source, pubDate, summary }) => ({
      title,
      link,
      source,
      pubDate,
      summary
    }))
  };

  const outputPath = path.resolve(__dirname, "..", "news.json");
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Saved ${output.items.length} items to ${outputPath}`);
}

main().catch((error) => {
  console.error(`Failed to generate news.json: ${error.message}`);
  process.exitCode = 1;
});
