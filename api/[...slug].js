const {
  scrapeHome,
  scrapeAnimeDetail,
  scrapeEpisodes,
  scrapeAnimeWithEpisodes,
  searchAnime,
  scrapeGenre,
  scrapeGenres,
  scrapeAZList,
  calculateNextEpisodeEstimate,
  BASE_URL,
} = require('../scraper.js');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Parse URL
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams);

  try {
    // GET /docs
    if (pathname === '/docs') {
      return res.json({
        name: 'Anikoto Scraper API',
        version: '1.0.0',
        description: 'REST API for scraping anime data from anikoto.cz',
        baseUrl: 'https://YOUR-VERCEL-URL.vercel.app/api',
        endpoints: {
          'GET /api/home': { description: 'Scrape homepage data', example: '/api/home' },
          'GET /api/anime/:slug': { description: 'Get anime details', example: '/api/anime/one-piece-odmau' },
          'GET /api/anime/:slug/episodes': { description: 'Get episodes + next episode estimate', example: '/api/anime/one-piece-odmau/episodes' },
          'GET /api/anime/:slug/full': { description: 'Get anime + episodes + servers', example: '/api/anime/one-piece-odmau/full?servers=true&limit=10' },
          'GET /api/search': { description: 'Search anime', example: '/api/search?keyword=naruto' },
          'GET /api/genre/:name': { description: 'Get anime by genre', example: '/api/genre/action' },
          'GET /api/genres': { description: 'List all genres', example: '/api/genres' },
          'GET /api/az-list': { description: 'A-Z list', example: '/api/az-list?letter=A' },
        },
        nextEpisodeEstimate: {
          description: 'Estimated time for next episode',
          fields: {
            estimatedTime: 'ISO 8601 timestamp',
            pattern: 'daily, weekly, monthly, or unknown',
            confidence: 'high, medium, or low',
          },
        },
        limits: {
          maxDuration: '60 seconds per request',
          rateLimit: 'Implement your own rate limiting',
        },
      });
    }

    // GET /api/home
    if (pathname === '/api/home') {
      const data = await scrapeHome();
      return res.json({ success: true, data });
    }

    // GET /api/anime/:slug
    if (pathname.match(/^\/api\/anime\/[^\/]+$/)) {
      const slug = pathname.split('/')[3];
      const data = await scrapeAnimeDetail(slug);
      return res.json({ success: true, data });
    }

    // GET /api/anime/:slug/episodes
    if (pathname.match(/^\/api\/anime\/[^\/]+\/episodes$/)) {
      const slug = pathname.split('/')[3];
      const detail = await scrapeAnimeDetail(slug);
      if (!detail.animeId) {
        return res.status(400).json({ success: false, error: 'Could not extract animeId' });
      }
      const episodes = await scrapeEpisodes(detail.animeId, detail.slug);
      const broadcastInfo = detail.aired || detail.broadcast || '';
      const nextEpisodeEstimate = calculateNextEpisodeEstimate(episodes, broadcastInfo);
      
      return res.json({
        success: true,
        data: {
          anime: detail.title,
          animeId: detail.animeId,
          status: detail.status,
          broadcast: broadcastInfo,
          episodes,
          nextEpisodeEstimate,
        },
      });
    }

    // GET /api/anime/:slug/full
    if (pathname.match(/^\/api\/anime\/[^\/]+\/full$/)) {
      const slug = pathname.split('/')[3];
      const data = await scrapeAnimeWithEpisodes(slug, {
        includeServers: query.servers === 'true',
        includeVideoUrls: query.videos === 'true',
        limit: query.limit ? parseInt(query.limit, 10) : 0,
      });
      return res.json({ success: true, data });
    }

    // GET /api/search
    if (pathname === '/api/search') {
      if (!query.keyword) {
        return res.status(400).json({ success: false, error: 'Missing keyword parameter' });
      }
      const page = parseInt(query.page, 10) || 1;
      const data = await searchAnime(query.keyword, page);
      return res.json({ success: true, data });
    }

    // GET /api/genre/:name
    if (pathname.match(/^\/api\/genre\/[^\/]+$/)) {
      const name = pathname.split('/')[3];
      const page = parseInt(query.page, 10) || 1;
      const data = await scrapeGenre(name, page);
      return res.json({ success: true, data });
    }

    // GET /api/genres
    if (pathname === '/api/genres') {
      const data = await scrapeGenres();
      return res.json({ success: true, data });
    }

    // GET /api/az-list
    if (pathname === '/api/az-list') {
      const letter = query.letter || '';
      const page = parseInt(query.page, 10) || 1;
      const limit = parseInt(query.limit, 10) || 0;
      const data = await scrapeAZList(letter, page, limit);
      return res.json({ success: true, data });
    }

    // 404
    return res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      docs: '/docs',
    });

  } catch (err) {
    console.error('[Vercel] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};
