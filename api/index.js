const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');

const {
  scrapeHome,
  scrapeHomeSection,
  scrapeAnimeDetail,
  scrapeEpisodes,
  scrapeEpisodeDetail,
  scrapeServers,
  scrapeVideoUrl,
  scrapeAnimeWithEpisodes,
  searchAnime,
  scrapeGenre,
  scrapeAZList,
  scrapeGenres,
} = require('../scraper');

const app = express();
app.use(cors());
app.use(express.json());

function setCache(res, seconds = 60) {
  res.set('Cache-Control', `public, max-age=${seconds}`);
}

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Anikoto API',
    version: '1.2.0',
    description: 'Unofficial REST API for anikoto.cz anime data. Provides structured anime metadata, episodes, servers, video URLs, search, browse, and documentation.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Home', description: 'Homepage sections and individual category feeds' },
    { name: 'Anime', description: 'Anime details, episodes, and full data' },
    { name: 'Episodes', description: 'Episode lists and single episode lookup' },
    { name: 'Servers', description: 'Streaming server lists' },
    { name: 'Video', description: 'Direct video stream URLs' },
    { name: 'Search', description: 'Search by keyword' },
    { name: 'Browse', description: 'Browse by genre and A-Z' },
    { name: 'Meta', description: 'Genres list and health checks' },
  ],
  paths: {
    '/api/home': {
      get: {
        tags: ['Home'],
        summary: 'Full homepage',
        description: 'Returns all homepage sections: latest episodes, upcoming, top lists, new releases, newly added, and completed.',
        responses: {
          '200': { description: 'Homepage data', content: { 'application/json': { schema: { type: 'object' } } } },
          '500': { description: 'Server error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
        },
      },
    },
    '/api/home/{section}': {
      get: {
        tags: ['Home'],
        summary: 'Individual homepage section',
        parameters: [
          { name: 'section', in: 'path', required: true, schema: { type: 'string', enum: ['latest','upcoming','top-day','top-week','top-month','new-release','new-added','completed'] }, description: 'Section name' },
        ],
        responses: {
          '200': { description: 'Section data', content: { 'application/json': { schema: { type: 'object' } } } },
          '400': { description: 'Unknown section' },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/anime/{slug}': {
      get: {
        tags: ['Anime'],
        summary: 'Get anime details',
        description: 'Returns anime details with normalized metadata fields (genres, status, aired, studios, etc.), trailer, and related anime.',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' }, description: 'Anime slug from anikoto.cz URL' },
        ],
        responses: {
          '200': { description: 'Anime details', content: { 'application/json': { schema: { type: 'object' } } } },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/anime/{slug}/episodes': {
      get: {
        tags: ['Episodes'],
        summary: 'Get all episodes',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' }, description: 'Anime slug' },
        ],
        responses: {
          '200': { description: 'Episode list with anime metadata', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': { description: 'Anime ID not found' },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/anime/{slug}/episodes/{number}': {
      get: {
        tags: ['Episodes'],
        summary: 'Get single episode',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' }, description: 'Anime slug' },
          { name: 'number', in: 'path', required: true, schema: { type: 'number' }, description: 'Episode number' },
        ],
        responses: {
          '200': { description: 'Single episode data', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': { description: 'Episode or anime not found' },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/full/{slug}': {
      get: {
        tags: ['Anime'],
        summary: 'Get full anime data',
        description: 'Returns anime details plus episodes. Optionally includes servers and video URLs.',
        parameters: [
          { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'servers', in: 'query', schema: { type: 'integer', enum: [0, 1] }, description: 'Include server lists (1 = yes)' },
          { name: 'videos', in: 'query', schema: { type: 'integer', enum: [0, 1] }, description: 'Include video URLs (1 = yes, requires servers=1)' },
          { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'Limit number of episodes returned' },
        ],
        responses: {
          '200': { description: 'Full anime data', content: { 'application/json': { schema: { type: 'object' } } } },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/servers': {
      get: {
        tags: ['Servers'],
        summary: 'Get servers for an episode',
        parameters: [
          { name: 'serverIds', in: 'query', required: true, schema: { type: 'string' }, description: 'Comma-separated server IDs from episode data' },
        ],
        responses: {
          '200': { description: 'Server list', content: { 'application/json': { schema: { type: 'array' } } } },
          '400': { description: 'Missing serverIds parameter' },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/video': {
      get: {
        tags: ['Video'],
        summary: 'Get video stream URL',
        parameters: [
          { name: 'linkId', in: 'query', required: true, schema: { type: 'string' }, description: 'Link ID from server data' },
        ],
        responses: {
          '200': { description: 'Video URL, skip data, and raw response', content: { 'application/json': { schema: { type: 'object' } } } },
          '400': { description: 'Missing linkId parameter' },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/search': {
      get: {
        tags: ['Search'],
        summary: 'Search anime',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' }, description: 'Search keyword' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: 'Page number' },
        ],
        responses: {
          '200': { description: 'Search results with pagination info (hasNextPage, totalPages)', content: { 'application/json': { schema: { type: 'object' } } } },
          '400': { description: 'Missing q parameter' },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/genre/{genre}': {
      get: {
        tags: ['Browse'],
        summary: 'Browse by genre',
        parameters: [
          { name: 'genre', in: 'path', required: true, schema: { type: 'string' }, description: 'Genre name (e.g. action, romance)' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        ],
        responses: {
          '200': { description: 'Genre results with pagination', content: { 'application/json': { schema: { type: 'object' } } } },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/az/{letter}': {
      get: {
        tags: ['Browse'],
        summary: 'A-Z anime list by letter',
        parameters: [
          { name: 'letter', in: 'path', required: true, schema: { type: 'string' }, description: 'First letter (A-Z)' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        ],
        responses: {
          '200': { description: 'A-Z list results with pagination', content: { 'application/json': { schema: { type: 'object' } } } },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/az': {
      get: {
        tags: ['Browse'],
        summary: 'A-Z anime list (all animes)',
        description: 'Returns all animes from A-Z list. Use page parameter for pagination (30 results per page).',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: 'Page number (30 results per page)' },
        ],
        responses: {
          '200': { description: 'A-Z list results with pagination', content: { 'application/json': { schema: { type: 'object' } } } },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/genres': {
      get: {
        tags: ['Meta'],
        summary: 'List all genres',
        responses: {
          '200': { description: 'Array of genre objects {slug, name}', content: { 'application/json': { schema: { type: 'array' } } } },
          '500': { description: 'Server error' },
        },
      },
    },
    '/api/health': {
      get: {
        tags: ['Meta'],
        summary: 'Health check',
        responses: {
          '200': { description: 'API is running', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' } } } } } },
        },
      },
    },
  },
};

// Swagger UI with proper configuration for serverless
const swaggerOptions = {
  explorer: false,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Anikoto API Docs',
};

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOptions));

// ─── Home ───
app.get('/api/home', async (req, res) => {
  try {
    setCache(res, 120);
    const data = await scrapeHome();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/home/:section', async (req, res) => {
  const valid = ['latest','upcoming','top-day','top-week','top-month','new-release','new-added','completed'];
  if (!valid.includes(req.params.section)) {
    return res.status(400).json({ error: `Invalid section. Valid: ${valid.join(', ')}` });
  }
  try {
    setCache(res, 120);
    const data = await scrapeHomeSection(req.params.section);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Anime ───
app.get('/api/anime/:slug', async (req, res) => {
  try {
    setCache(res, 300);
    const data = await scrapeAnimeDetail(req.params.slug);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/anime/:slug/episodes', async (req, res) => {
  try {
    setCache(res, 180);
    const detail = await scrapeAnimeDetail(req.params.slug);
    if (!detail.animeId) {
      return res.status(404).json({ error: 'Anime ID not found' });
    }
    const episodes = await scrapeEpisodes(detail.animeId, detail.slug);
    res.json({ anime: detail.title, animeId: detail.animeId, slug: detail.slug, episodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/anime/:slug/episodes/:number', async (req, res) => {
  try {
    setCache(res, 180);
    const detail = await scrapeAnimeDetail(req.params.slug);
    if (!detail.animeId) {
      return res.status(404).json({ error: 'Anime ID not found' });
    }
    const episode = await scrapeEpisodeDetail(detail.animeId, detail.slug, req.params.number);
    res.json({ anime: detail.title, animeId: detail.animeId, slug: detail.slug, episode });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/full/:slug', async (req, res) => {
  try {
    setCache(res, 180);
    const includeServers = req.query.servers === '1' || req.query.servers === 'true';
    const includeVideoUrls = req.query.videos === '1' || req.query.videos === 'true';
    const limit = parseInt(req.query.limit, 10) || 0;
    const data = await scrapeAnimeWithEpisodes(req.params.slug, { includeServers, includeVideoUrls, limit });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Servers & Video ───
app.get('/api/servers', async (req, res) => {
  try {
    setCache(res, 60);
    const serverIds = req.query.serverIds;
    if (!serverIds) {
      return res.status(400).json({ error: 'serverIds query param required' });
    }
    const data = await scrapeServers(serverIds);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/video', async (req, res) => {
  try {
    setCache(res, 60);
    const linkId = req.query.linkId;
    if (!linkId) {
      return res.status(400).json({ error: 'linkId query param required' });
    }
    const data = await scrapeVideoUrl(linkId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Search ───
app.get('/api/search', async (req, res) => {
  try {
    setCache(res, 120);
    const q = req.query.q;
    const page = parseInt(req.query.page, 10) || 1;
    if (!q) {
      return res.status(400).json({ error: 'q query param required' });
    }
    const data = await searchAnime(q, page);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Browse ───
app.get('/api/genre/:genre', async (req, res) => {
  try {
    setCache(res, 120);
    const page = parseInt(req.query.page, 10) || 1;
    const data = await scrapeGenre(req.params.genre, page);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A-Z endpoint - fixed to handle 'all' properly
app.get('/api/az', async (req, res) => {
  try {
    setCache(res, 120);
    const page = parseInt(req.query.page, 10) || 1;
    const data = await scrapeAZList('', page);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/az/:letter', async (req, res) => {
  try {
    setCache(res, 120);
    const page = parseInt(req.query.page, 10) || 1;
    const letter = req.params.letter;
    // Handle 'all' as special case - use empty string for base endpoint
    const data = await scrapeAZList(letter.toLowerCase() === 'all' ? '' : letter, page);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Meta ───
app.get('/api/genres', async (req, res) => {
  try {
    setCache(res, 3600);
    const data = await scrapeGenres();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 for API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Redirect root to docs
app.get('/', (req, res) => {
  res.redirect('/docs');
});

// Vercel serverless export
module.exports = app;

// Local development server (only when run directly)
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API running at http://localhost:${PORT}`);
    console.log(`Docs at http://localhost:${PORT}/docs`);
  });
}
