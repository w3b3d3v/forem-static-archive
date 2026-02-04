const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

// Configuration
const SITE_URL = 'https://yourdomain.com'; // Update when deploying
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
  engine.loadPartial('header', headerPartial);
  engine.loadPartial('footer', footerPartial);

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

      // Sanitize HTML (keep images with S3 URLs)
      contentHtml = sanitizeHtml(contentHtml, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          img: ['src', 'alt', 'title', 'width', 'height']
        },
        allowedSchemes: ['http', 'https', 'data']
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

  // Step 8: Generate sitemap.xml
  console.log('🗺️  Generating sitemap...');

  let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
  sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // Homepage
  sitemap += '  <url>\n';
  sitemap += `    <loc>${SITE_URL}/</loc>\n`;
  sitemap += '    <changefreq>daily</changefreq>\n';
  sitemap += '    <priority>1.0</priority>\n';
  sitemap += '  </url>\n';

  // Profile pages
  for (const username of usernames) {
    sitemap += '  <url>\n';
    sitemap += `    <loc>${SITE_URL}/${username}/</loc>\n`;
    sitemap += '    <changefreq>weekly</changefreq>\n';
    sitemap += '    <priority>0.8</priority>\n';
    sitemap += '  </url>\n';
  }

  // Article pages
  for (const username of usernames) {
    for (const article of articlesByUser[username]) {
      sitemap += '  <url>\n';
      sitemap += `    <loc>${SITE_URL}/${username}/${article.slug}</loc>\n`;
      sitemap += `    <lastmod>${article.updated_at || article.published_at}</lastmod>\n`;
      sitemap += '    <changefreq>never</changefreq>\n';
      sitemap += '    <priority>0.6</priority>\n';
      sitemap += '  </url>\n';
    }
  }

  sitemap += '</urlset>';
  fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), sitemap);

  console.log('   ✅ Generated sitemap.xml\n');

  // Step 9: Generate robots.txt
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

# Sitemap
Sitemap: ${SITE_URL}/sitemap.xml
`;

  fs.writeFileSync(path.join(PUBLIC_DIR, 'robots.txt'), robotsTxt);

  console.log('   ✅ Generated robots.txt\n');

  // Summary
  console.log('✨ Build complete!\n');
  console.log('📊 Summary:');
  console.log(`   - ${articleCount} article pages`);
  console.log(`   - ${profileCount} profile pages`);
  console.log(`   - 1 homepage`);
  console.log(`   - sitemap.xml with ${articleCount + profileCount + 1} URLs`);
  console.log(`   - robots.txt\n`);
  console.log(`🌐 Run 'npm run serve' to test locally`);
}

// Run build
build().catch(error => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
