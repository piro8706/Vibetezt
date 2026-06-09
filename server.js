const express = require('express');
const path = require('path');

const {
  scrapeHome,
  scrapeAnimeDetail,
  scrapeEpisodes,
  scrapeAnimeWithEpisodes,
  searchAnime,
  scrapeGenre,
  scrapeGenres,
  scrapeAZList,
  scrapeAllAnimes,
  calculateNextEpisodeEstimate,
} = require('./scraper.js');

const app = express();
const PORT = 3000;

app.use(express.json());

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// API Documentation
app.get('/docs', (req, res) => {
  res.json({
    name: 'Anikoto Scraper API',
    version: '1.0.0',
    description: 'REST API for scraping anime data from anikoto.cz',
    baseUrl: `http://localhost:${PORT}/api`,
    endpoints: {
      'GET /api/home': {
        description: 'Scrape homepage data including latest episodes, top anime, and more',
        params: {},
        response: {
          latestEpisodes: 'array',
          upcomingAnime: 'array',
          topDay: 'array',
          topWeek: 'array',
          topMonth: 'array',
          newRelease: 'array',
          newlyAdded: 'array',
          justCompleted: 'array',
        },
        example: `curl http://localhost:${PORT}/api/home`,
      },
      'GET /api/anime/:slug': {
        description: 'Get detailed anime information by slug',
        params: { slug: 'Anime slug from URL (e.g., one-piece-odmau)' },
        response: {
          slug: 'string',
          animeId: 'number',
          title: 'string',
          jpTitle: 'string',
          synopsis: 'string',
          thumbnail: 'string',
          genres: 'array',
          status: 'string',
          rating: 'string',
          related: 'array',
        },
        example: `curl http://localhost:${PORT}/api/anime/one-piece-odmau`,
      },
      'GET /api/anime/:slug/episodes': {
        description: 'Get episode list for an anime with next episode estimate',
        params: { slug: 'Anime slug from URL' },
        response: {
          anime: 'string',
          animeId: 'number',
          episodes: 'array',
          nextEpisodeEstimate: 'object | null',
        },
        example: `curl http://localhost:${PORT}/api/anime/one-piece-odmau/episodes`,
      },
      'GET /api/anime/:slug/full': {
        description: 'Get anime details with all episodes (optionally with servers and video URLs)',
        params: {
          slug: 'Anime slug from URL',
          servers: 'Include server lists (true/false)',
          videos: 'Include video URLs (true/false) - requires servers=true',
          limit: 'Limit number of episodes (number)',
        },
        example: `curl "http://localhost:${PORT}/api/anime/one-piece-odmau/full?servers=true&limit=10"`,
      },
      'GET /api/search': {
        description: 'Search for anime by keyword',
        params: {
          keyword: 'Search term (required)',
          page: 'Page number (default: 1)',
        },
        example: `curl "http://localhost:${PORT}/api/search?keyword=naruto&page=1"`,
      },
      'GET /api/genre/:name': {
        description: 'Get anime by genre',
        params: {
          name: 'Genre name (e.g., action, comedy)',
          page: 'Page number (default: 1)',
        },
        example: `curl "http://localhost:${PORT}/api/genre/action?page=1"`,
      },
      'GET /api/genres': {
        description: 'List all available genres',
        params: {},
        example: `curl http://localhost:${PORT}/api/genres`,
      },
      'GET /api/az-list': {
        description: 'Get A-Z anime list',
        params: {
          letter: 'Letter filter (A-Z or empty for all)',
          page: 'Page number (default: 1)',
          limit: 'Limit results (number)',
        },
        example: `curl "http://localhost:${PORT}/api/az-list?letter=A&page=1"`,
      },
    },
    nextEpisodeEstimate: {
      description: 'Estimated time for next episode based on release patterns',
      fields: {
        estimatedTime: 'ISO 8601 timestamp of estimated release',
        estimatedTimestamp: 'Unix timestamp',
        pattern: 'Release pattern: daily, weekly, monthly, or unknown',
        basedOn: 'Calculation method: release interval or broadcast info',
        confidence: 'high, medium, or low',
      },
    },
  });
});

// Health check
app.get('/', (req, res) => {
  res.json({
    name: 'Anikoto Scraper API',
    version: '1.0.0',
    status: 'running',
    docs: `http://localhost:${PORT}/docs`,
  });
});

// GET /api/home
app.get('/api/home', async (req, res) => {
  try {
    console.log('[API] Scraping homepage...');
    const data = await scrapeHome();
    res.json({ success: true, data });
  } catch (err) {
    console.error('[API] Home error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/anime/:slug
app.get('/api/anime/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    console.log(`[API] Scraping anime: ${slug}`);
    const data = await scrapeAnimeDetail(slug);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[API] Anime detail error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/anime/:slug/episodes
app.get('/api/anime/:slug/episodes', async (req, res) => {
  try {
    const { slug } = req.params;
    console.log(`[API] Scraping episodes for: ${slug}`);
    const detail = await scrapeAnimeDetail(slug);
    if (!detail.animeId) {
      return res.status(400).json({ success: false, error: 'Could not extract animeId' });
    }
    const episodes = await scrapeEpisodes(detail.animeId, detail.slug);
    
    // Calculate next episode estimate
    const broadcastInfo = detail.aired || detail.broadcast || '';
    const nextEpisodeEstimate = calculateNextEpisodeEstimate(episodes, broadcastInfo);
    
    res.json({ 
      success: true, 
      data: { 
        anime: detail.title, 
        animeId: detail.animeId,
        status: detail.status,
        broadcast: broadcastInfo,
        episodes,
        nextEpisodeEstimate,
      } 
    });
  } catch (err) {
    console.error('[API] Episodes error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/anime/:slug/full (includes episodes, optional servers/videos)
app.get('/api/anime/:slug/full', async (req, res) => {
  try {
    const { slug } = req.params;
    const { servers, videos, limit } = req.query;
    console.log(`[API] Scraping full data for: ${slug}`);
    
    const data = await scrapeAnimeWithEpisodes(slug, {
      includeServers: servers === 'true',
      includeVideoUrls: videos === 'true',
      limit: limit ? parseInt(limit, 10) : 0,
    });
    
    res.json({ success: true, data });
  } catch (err) {
    console.error('[API] Full anime error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/search
app.get('/api/search', async (req, res) => {
  try {
    const { keyword, page = 1 } = req.query;
    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Missing keyword parameter' });
    }
    console.log(`[API] Searching: ${keyword} (page ${page})`);
    const data = await searchAnime(keyword, parseInt(page, 10));
    res.json({ success: true, data });
  } catch (err) {
    console.error('[API] Search error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/genre/:name
app.get('/api/genre/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { page = 1 } = req.query;
    console.log(`[API] Scraping genre: ${name} (page ${page})`);
    const data = await scrapeGenre(name, parseInt(page, 10));
    res.json({ success: true, data });
  } catch (err) {
    console.error('[API] Genre error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/genres
app.get('/api/genres', async (req, res) => {
  try {
    console.log('[API] Scraping genres list...');
    const data = await scrapeGenres();
    res.json({ success: true, data });
  } catch (err) {
    console.error('[API] Genres error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/az-list
app.get('/api/az-list', async (req, res) => {
  try {
    const { letter = '', page = 1, limit = 0 } = req.query;
    console.log(`[API] Scraping A-Z list: ${letter || 'All'} (page ${page})`);
    const data = await scrapeAZList(letter, parseInt(page, 10), parseInt(limit, 10));
    res.json({ success: true, data });
  } catch (err) {
    console.error('[API] A-Z list error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[API] Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║     Anikoto Scraper API Server Running         ║
╠════════════════════════════════════════════════╣
║  Local:   http://localhost:${PORT}               ║
║  API:     http://localhost:${PORT}/api           ║
║  Docs:    http://localhost:${PORT}/docs          ║
╠════════════════════════════════════════════════╣
║  Endpoints:                                    ║
║  GET /api/home                                 ║
║  GET /api/anime/:slug                          ║
║  GET /api/anime/:slug/episodes  [+next ep]     ║
║  GET /api/anime/:slug/full                     ║
║  GET /api/search?keyword=<query>               ║
║  GET /api/genre/:name                          ║
║  GET /api/genres                               ║
║  GET /api/az-list?letter=A&page=1              ║
╚════════════════════════════════════════════════╝
  `);
});
