const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

// Configuration
const SITE_URL = 'https://pt.w3d.community';
const DATA_DIR = path.join(__dirname, '../data');
const TEMPLATES_DIR = path.join(__dirname, '../templates');
const PUBLIC_DIR = path.join(__dirname, '../public');

// Simple template engine (Handlebars-like)
class TemplateEngine {
  constructor() {
    this.partials = {};
  }

  loadPartial(name, content) {
    this.partials[name] = content;
  }

  render(template, data) {
    let output = template;

    // Replace partials {{> partialName}}
    output = output.replace(/\{\{>\s*(\w+)\s*\}\}/g, (match, name) => {
      return this.partials[name] || '';
    });

    // Replace conditionals {{#if var}}...{{/if}}
    output = output.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, key, content) => {
      return data[key] ? content : '';
    });

    // Replace each loops {{#each items}}...{{/each}}
    output = output.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, key, content) => {
      const items = data[key] || [];
      return items.map(item => this.render(content, { ...data, ...item })).join('');
    });

    // Replace variables {{var}} and {{{var}}} (unescaped)
    output = output.replace(/\{\{\{(\w+)\}\}\}/g, (match, key) => {
      return data[key] !== undefined ? data[key] : '';
    });
    output = output.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = data[key] !== undefined ? data[key] : '';
      return this.escapeHtml(String(value));
    });

    return output;
  }

  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

// Utility: Format date
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('pt-BR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Utility: Generate description from HTML
function generateDescription(html, maxLength = 160) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

// Utility: Calculate reading time
function calculateReadingTime(html) {
  const text = html.replace(/<[^>]*>/g, ' ');
  const words = text.trim().split(/\s+/).length;
  return Math.ceil(words / 200); // Average reading speed: 200 words/min
}

// Utility: Convert Liquid tags to HTML
function convertLiquidTags(html) {
  let converted = html;

  // Convert YouTube embeds: {% youtube URL %}
  // Note: URL might be wrapped in <a> tags from CSV parsing
  converted = converted.replace(/\{%\s*youtube\s+(.+?)\s*%\}/gi, (match, content) => {
    // Extract URL from content (might be plain URL or wrapped in <a> tag)
    let url = content.trim();

    // If content contains an <a> tag, extract the href
    const hrefMatch = url.match(/href=["']([^"']+)["']/);
    if (hrefMatch) {
      url = hrefMatch[1];
    }

    // Extract video ID from various YouTube URL formats
    let videoId = null;

    // Format: https://youtube.com/watch?v=VIDEO_ID
    // Format: https://www.youtube.com/watch?v=VIDEO_ID
    // Format: https://youtu.be/VIDEO_ID
    // Format: https://youtube.com/VIDEO_ID (direct ID after domain)
    // Format: https://www.youtube.com/embed/VIDEO_ID

    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/,
      /(?:youtube\.com|www\.youtube\.com)\/([a-zA-Z0-9_-]{11})$/,  // Direct ID after domain
      /^([a-zA-Z0-9_-]{11})$/ // Just the video ID
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        videoId = match[1];
        break;
      }
    }

    if (videoId) {
      return `<div class="video-embed" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; max-width: 100%; margin: 2rem 0;">
  <iframe
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
    src="https://www.youtube.com/embed/${videoId}"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen
    loading="lazy"
  ></iframe>
</div>`;
    }

    // If we can't parse the video ID, return a link
    return `<p><a href="${url}" target="_blank" rel="noopener">Watch on YouTube</a></p>`;
  });

  // Convert other common Liquid tags to simple text or links
  // {% link URL %} or {% embed URL %}
  converted = converted.replace(/\{%\s*(link|embed)\s+([^\s%]+)\s*%\}/gi, (match, tag, url) => {
    return `<p><a href="${url}" target="_blank" rel="noopener">${url}</a></p>`;
  });

  // Remove any remaining Liquid tags
  converted = converted.replace(/\{%[^%]*%\}/g, '');

  return converted;
}

// Load CSV as promise
function loadCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => results.push(row))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

// Main build function
async function build() {
  console.log('🚀 Starting build process...\n');

  // Step 1: Load data
  console.log('📊 Loading CSV data...');
  const articles = await loadCSV(path.join(DATA_DIR, 'forem_articles_filtered_by_outdated.csv'));
  const users = await loadCSV(path.join(DATA_DIR, 'forem_users_with_published_articles.csv'));

  console.log(`   Loaded ${articles.length} articles`);
  console.log(`   Loaded ${users.length} users\n`);

  // Step 2: Filter published articles
  console.log('🔍 Filtering published articles...');
  const publishedArticles = articles.filter(article =>
    article.published === 't' &&
    article.archived === 'f' &&
    !article.deleted_at
  );

  console.log(`   Filtered to ${publishedArticles.length} published articles\n`);

  // Step 3: Group articles by user
  console.log('👥 Grouping articles by author...');
  const articlesByUser = {};
  publishedArticles.forEach(article => {
    const username = article.cached_user_username;
    if (!username) return;

    if (!articlesByUser[username]) {
      articlesByUser[username] = [];
    }
    articlesByUser[username].push(article);
  });

  const usernames = Object.keys(articlesByUser);
  console.log(`   Found ${usernames.length} authors with articles\n`);

  // Step 4: Load templates
  console.log('📝 Loading templates...');
  const engine = new TemplateEngine();

  // Load partials
  const headerPartial = fs.readFileSync(path.join(TEMPLATES_DIR, 'partials/header.html'), 'utf-8');
  const footerPartial = fs.readFileSync(path.join(TEMPLATES_DIR, 'partials/footer.html'), 'utf-8');
  const analyticsPartial = fs.readFileSync(path.join(TEMPLATES_DIR, 'partials/analytics.html'), 'utf-8');
  engine.loadPartial('header', headerPartial);
  engine.loadPartial('footer', footerPartial);
  engine.loadPartial('analytics', analyticsPartial);

  // Load templates
  const articleTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'article.html'), 'utf-8');
  const profileTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'profile.html'), 'utf-8');
  const indexTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, 'index.html'), 'utf-8');

  console.log('   Templates loaded\n');

  // Step 5: Generate article pages
  console.log('📄 Generating article pages...');
  let articleCount = 0;

  for (const username of usernames) {
    const userArticles = articlesByUser[username];

    // Create user directory
    const userDir = path.join(PUBLIC_DIR, username);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // Generate article pages
    for (const article of userArticles) {
      const slug = article.slug;
      if (!slug) continue;

      // Use body_html if available, otherwise parse body_markdown
      let contentHtml = article.body_html || '';
      if (!contentHtml && article.body_markdown) {
        contentHtml = marked.parse(article.body_markdown);
      }

      // Convert Liquid tags (YouTube embeds, etc.)
      contentHtml = convertLiquidTags(contentHtml);

      // Sanitize HTML (keep images with S3 URLs and iframes for YouTube)
      contentHtml = sanitizeHtml(contentHtml, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'iframe', 'div']),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          img: ['src', 'alt', 'title', 'width', 'height'],
          iframe: ['src', 'frameborder', 'allow', 'allowfullscreen', 'loading', 'style', 'width', 'height'],
          div: ['class', 'style']
        },
        allowedSchemes: ['http', 'https', 'data'],
        allowedIframeHostnames: ['www.youtube.com', 'youtube.com'],
        allowIframeRelativeUrls: false
      });

      const description = article.description || generateDescription(contentHtml);
      const readingTime = article.reading_time || calculateReadingTime(contentHtml);

      const articleData = {
        title: article.title || 'Untitled',
        author: article.cached_user_name || username,
        username: username,
        description: description,
        contentHtml: contentHtml,
        featuredImage: article.main_image || '',
        publishedAt: article.published_at || '',
        updatedAt: article.updated_at || article.published_at || '',
        publishedDate: formatDate(article.published_at),
        readingTime: readingTime,
        slug: slug,
        canonicalUrl: `${SITE_URL}/${username}/${slug}`,
        authorUrl: `${SITE_URL}/${username}`,
        siteUrl: SITE_URL
      };

      const html = engine.render(articleTemplate, articleData);
      const filePath = path.join(userDir, `${slug}.html`);
      fs.writeFileSync(filePath, html);
      articleCount++;

      if (articleCount % 100 === 0) {
        console.log(`   Generated ${articleCount} articles...`);
      }
    }
  }

  console.log(`   ✅ Generated ${articleCount} article pages\n`);

  // Step 6: Generate profile pages
  console.log('👤 Generating profile pages...');
  let profileCount = 0;

  for (const username of usernames) {
    const userArticles = articlesByUser[username].map(article => ({
      title: article.title || 'Untitled',
      slug: article.slug,
      username: username, // Add username to each article
      description: article.description || generateDescription(article.body_html || ''),
      publishedAt: article.published_at || '',
      publishedDate: formatDate(article.published_at),
      readingTime: article.reading_time || calculateReadingTime(article.body_html || '')
    }));

    // Sort by date (newest first)
    userArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    const profileData = {
      username: username,
      articleCount: userArticles.length,
      articles: userArticles,
      canonicalUrl: `${SITE_URL}/${username}`
    };

    const html = engine.render(profileTemplate, profileData);
    const filePath = path.join(PUBLIC_DIR, username, 'index.html');
    fs.writeFileSync(filePath, html);
    profileCount++;
  }

  console.log(`   ✅ Generated ${profileCount} profile pages\n`);

  // Step 7: Generate homepage
  console.log('🏠 Generating homepage...');

  const allArticles = [];
  for (const username of usernames) {
    articlesByUser[username].forEach(article => {
      allArticles.push({
        title: article.title || 'Untitled',
        author: article.cached_user_name || username,
        username: username,
        slug: article.slug,
        description: article.description || generateDescription(article.body_html || ''),
        publishedAt: article.published_at || '',
        publishedDate: formatDate(article.published_at),
        readingTime: article.reading_time || calculateReadingTime(article.body_html || '')
      });
    });
  }

  // Sort by date (newest first)
  allArticles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const indexData = {
    articleCount: allArticles.length,
    userCount: usernames.length,
    articles: allArticles.slice(0, 100), // Show latest 100 on homepage
    canonicalUrl: SITE_URL
  };

  const indexHtml = engine.render(indexTemplate, indexData);
  fs.writeFileSync(path.join(PUBLIC_DIR, 'index.html'), indexHtml);

  console.log('   ✅ Generated homepage\n');

  // Step 8: Generate sitemaps
  console.log('🗺️  Generating sitemaps...');

  // sitemap-posts.xml (articles)
  let sitemapPosts = '<?xml version="1.0" encoding="UTF-8"?>\n';
  sitemapPosts += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const username of usernames) {
    for (const article of articlesByUser[username]) {
      sitemapPosts += '  <url>\n';
      sitemapPosts += `    <loc>${SITE_URL}/${username}/${article.slug}</loc>\n`;
      sitemapPosts += `    <lastmod>${article.updated_at || article.published_at}</lastmod>\n`;
      sitemapPosts += '    <changefreq>never</changefreq>\n';
      sitemapPosts += '    <priority>0.6</priority>\n';
      sitemapPosts += '  </url>\n';
    }
  }
  sitemapPosts += '</urlset>';
  fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap-posts.xml'), sitemapPosts);

  // sitemap-users.xml (profile pages)
  let sitemapUsers = '<?xml version="1.0" encoding="UTF-8"?>\n';
  sitemapUsers += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const username of usernames) {
    sitemapUsers += '  <url>\n';
    sitemapUsers += `    <loc>${SITE_URL}/${username}/</loc>\n`;
    sitemapUsers += '    <changefreq>weekly</changefreq>\n';
    sitemapUsers += '    <priority>0.8</priority>\n';
    sitemapUsers += '  </url>\n';
  }
  sitemapUsers += '</urlset>';
  fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap-users.xml'), sitemapUsers);

  // sitemap-index.xml (main sitemap index)
  let sitemapIndex = '<?xml version="1.0" encoding="UTF-8"?>\n';
  sitemapIndex += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  sitemapIndex += '  <sitemap>\n';
  sitemapIndex += `    <loc>${SITE_URL}/sitemap-posts.xml</loc>\n`;
  sitemapIndex += '  </sitemap>\n';
  sitemapIndex += '  <sitemap>\n';
  sitemapIndex += `    <loc>${SITE_URL}/sitemap-users.xml</loc>\n`;
  sitemapIndex += '  </sitemap>\n';
  sitemapIndex += '</sitemapindex>';
  fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap-index.xml'), sitemapIndex);

  // Keep the original sitemap.xml for homepage
  let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
  sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  sitemap += '  <url>\n';
  sitemap += `    <loc>${SITE_URL}/</loc>\n`;
  sitemap += '    <changefreq>daily</changefreq>\n';
  sitemap += '    <priority>1.0</priority>\n';
  sitemap += '  </url>\n';
  sitemap += '</urlset>';
  fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), sitemap);

  console.log('   ✅ Generated sitemap-posts.xml');
  console.log('   ✅ Generated sitemap-users.xml');
  console.log('   ✅ Generated sitemap-index.xml');
  console.log('   ✅ Generated sitemap.xml\n');

  // Step 9: Generate llms.txt
  async function generateLlmsTxt(articles, users) {
    // Count tags
    const tagCounts = {};
    articles.forEach(article => {
      if (article.cached_tag_list) {
        const tags = article.cached_tag_list.split(',').map(t => t.trim());
        tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      }
    });

    // Get top 15 topics
    const topTopics = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    // Count articles by author
    const authorCounts = {};
    articles.forEach(article => {
      const username = article.cached_user_username;
      if (username) {
        authorCounts[username] = (authorCounts[username] || 0) + 1;
      }
    });

    // Get top 10 authors
    const topAuthors = Object.entries(authorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Get latest 20 articles
    const latestArticles = articles
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
      .slice(0, 20);

    // Build llms.txt
    let llmsTxt = `# WEB3DEV Portuguese Archive\n\n`;
    llmsTxt += `> A comprehensive archive of ${articles.length} Web3 and blockchain articles in Portuguese, covering topics from smart contract development to decentralized finance.\n\n`;
    llmsTxt += `This archive preserves high-quality educational content from the WEB3DEV community, featuring tutorials, guides, and technical articles about blockchain technology, Ethereum, Solana, and Web3 development.\n\n`;

    llmsTxt += `## Popular Topics\n\n`;
    topTopics.forEach(([tag, count]) => {
      const descriptions = {
        'Blockchain': 'blockchain fundamentals, architecture, and applications',
        'Solidity': 'smart contract programming and development',
        'Ethereum': 'the Ethereum ecosystem and EVM',
        'Web3': 'Web3 technologies and decentralized applications',
        'NFT': 'non-fungible tokens and digital collectibles',
        'Web3Dev': 'the Web3Dev community',
        'DeFi': 'decentralized finance protocols and concepts',
        'Solana': 'Solana development and ecosystem',
        'Rust': 'Rust programming for blockchain',
        'DApp': 'decentralized application development',
        'DAO': 'decentralized autonomous organizations',
        'Smart Contract': 'smart contract development and security',
        'NEAR': 'NEAR Protocol',
        'Token': 'tokenomics and token standards',
        'EVM': 'Ethereum Virtual Machine'
      };
      const desc = descriptions[tag] || tag.toLowerCase();
      llmsTxt += `- [${tag}](${SITE_URL}): ${count} articles covering ${desc}\n`;
    });

    llmsTxt += `\n## Top Authors\n\n`;
    topAuthors.forEach(([username, count]) => {
      llmsTxt += `- [${username}](${SITE_URL}/${username}): ${count} articles\n`;
    });

    llmsTxt += `\n## Latest Articles\n\n`;
    latestArticles.forEach(article => {
      const url = `${SITE_URL}/${article.cached_user_username}/${article.slug}`;
      const desc = article.description ? article.description.substring(0, 100) : article.title;
      llmsTxt += `- [${article.title}](${url}): ${desc}\n`;
    });

    fs.writeFileSync(path.join(PUBLIC_DIR, 'llms.txt'), llmsTxt);
  }

  // Step 10: Generate robots.txt
  console.log('🤖 Generating robots.txt...');

  const robotsTxt = `# Allow all crawlers
User-agent: *
Allow: /

# AI Crawlers
User-agent: GPTBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: ChatGPT-User
Allow: /

# Sitemaps
Sitemap: ${SITE_URL}/sitemap-index.xml
Sitemap: ${SITE_URL}/sitemap-posts.xml
Sitemap: ${SITE_URL}/sitemap-users.xml
`;

  fs.writeFileSync(path.join(PUBLIC_DIR, 'robots.txt'), robotsTxt);

  console.log('   ✅ Generated robots.txt\n');

  // Generate llms.txt
  console.log('🤖 Generating llms.txt...');
  await generateLlmsTxt(articles, users);
  console.log('   ✅ Generated llms.txt\n');

  // Summary
  console.log('✨ Build complete!\n');
  console.log('📊 Summary:');
  console.log(`   - ${articleCount} article pages`);
  console.log(`   - ${profileCount} profile pages`);
  console.log(`   - 1 homepage`);
  console.log(`   - sitemap.xml with ${articleCount + profileCount + 1} URLs`);
  console.log(`   - robots.txt`);
  console.log(`   - llms.txt\n`);
  console.log(`🌐 Run 'npm run serve' to test locally`);
}

// Run build
build().catch(error => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
