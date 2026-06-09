// Simple docs endpoint for Vercel
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  res.json({
    name: 'Anikoto Scraper API',
    version: '1.0.0',
    description: 'REST API for scraping anime data from anikoto.cz',
    endpoints: {
      'GET /api/home': 'Scrape homepage data',
      'GET /api/anime/:slug': 'Get anime details',
      'GET /api/anime/:slug/episodes': 'Get episodes + next episode estimate',
      'GET /api/anime/:slug/full': 'Get anime + episodes + servers',
      'GET /api/search?keyword=X': 'Search anime',
      'GET /api/genre/:name': 'Get anime by genre',
      'GET /api/genres': 'List all genres',
      'GET /api/az-list?letter=A': 'A-Z list',
    },
  });
};
