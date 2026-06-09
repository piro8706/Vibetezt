const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://anikoto.cz';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
  },
  timeout: 15000,
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHTML(url, extraHeaders = {}) {
  try {
    const response = await client.get(url, { headers: extraHeaders });
    return cheerio.load(response.data);
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    throw error;
  }
}

async function fetchJSON(url, extraHeaders = {}) {
  try {
    const response = await client.get(url, { headers: extraHeaders });
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    throw error;
  }
}

function extractAnimeFromItem($, item) {
  const $item = $(item);
  // Try finding <a> as child first, then as parent
  let link = $item.find('a').first();
  let href = link.attr('href') || '';
  if (!href) {
    link = $item.closest('a');
    href = link.attr('href') || '';
  }
  const slugMatch = href.match(/\/watch\/([^/]+)/);
  const slug = slugMatch ? slugMatch[1] : '';

  const nameEl = $item.find('.name, .info .name, a.name');
  const title = nameEl.text().trim() || '';
  const jpTitle = nameEl.attr('data-jp') || '';

  const img = $item.find('img').first();
  const thumbnail = img.attr('src') || img.attr('data-src') || '';

  const type = $item.find('.meta .right, .meta .dot').last().text().trim() || '';

  const epStatus = {};
  $item.find('.ep-status').each((_, el) => {
    const cls = $(el).attr('class') || '';
    const num = $(el).find('span').text().trim();
    if (cls.includes('sub')) epStatus.sub = num;
    if (cls.includes('dub')) epStatus.dub = num;
    if (cls.includes('total')) epStatus.total = num;
  });

  // Try to grab list-score / rating if present
  const score = $item.find('.score, .rating, .meta .left, .meta .score').first().text().trim() || '';

  // Status badge (e.g. "Completed", "Ongoing")
  const status = $item.find('.status, .badge, .meta .status').first().text().trim() || '';

  return {
    slug,
    title,
    jpTitle,
    thumbnail,
    type,
    status,
    score,
    episodes: epStatus,
    url: href.startsWith('http') ? href : `${BASE_URL}${href}`,
  };
}

function normalizeMeta(meta) {
  const normalized = {
    genres: [],
    status: '',
    aired: '',
    premiered: '',
    broadcast: '',
    producers: '',
    studios: '',
    source: '',
    duration: '',
    rating: '', // age rating
    type: '',
    synonyms: '',
    totalEpisodes: '',
    originalName: '',
  };

  const arrayFields = ['genres', 'genre', 'producers', 'studios', 'licensors', 'themes'];
  const mapKeys = {
    genre: 'genres',
    genres: 'genres',
    status: 'status',
    aired: 'aired',
    premiered: 'premiered',
    broadcast: 'broadcast',
    producers: 'producers',
    studios: 'studios',
    studio: 'studios',
    source: 'source',
    duration: 'duration',
    rating: 'rating',
    type: 'type',
    synonyms: 'synonyms',
    'total episodes': 'totalEpisodes',
    'original name': 'originalName',
    'original title': 'originalName',
    'japanese': 'originalName',
  };

  for (const [key, value] of Object.entries(meta)) {
    const lowerKey = key.toLowerCase().trim();
    const mapped = mapKeys[lowerKey] || lowerKey;

    if (arrayFields.includes(lowerKey)) {
      normalized[mapped] = value.split(',').map(s => s.trim()).filter(Boolean);
    } else if (normalized.hasOwnProperty(mapped)) {
      normalized[mapped] = value;
    }
  }

  return normalized;
}

function extractPagination($) {
  const nextPage = $('.pagination .page-item.active').next('.page-item').find('a').attr('href');
  const hasNextPage = !!nextPage;

  // Try to infer total pages from pagination links
  let totalPages = 0;
  $('.pagination .page-item a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const pageMatch = href.match(/[?&]page=(\d+)/);
    if (pageMatch) {
      const p = parseInt(pageMatch[1], 10);
      if (p > totalPages) totalPages = p;
    }
    const text = parseInt($(el).text().trim(), 10);
    if (!isNaN(text) && text > totalPages) totalPages = text;
  });

  // If there's a next page but totalPages is still 0 or equal to current, assume at least current+1
  const currentPage = parseInt($('.pagination .page-item.active').text().trim(), 10) || 1;
  if (hasNextPage && totalPages <= currentPage) {
    totalPages = currentPage + 1;
  }

  return { hasNextPage, totalPages, currentPage };
}

// ─── Home Page ───
async function scrapeHome() {
  const $ = await fetchHTML('/home');
  const results = {
    latestEpisodes: [],
    upcomingAnime: [],
    topDay: [],
    topWeek: [],
    topMonth: [],
    newRelease: [],
    newlyAdded: [],
    justCompleted: [],
  };

  $('#recent-update .ani.items .item').each((_, el) => {
    results.latestEpisodes.push(extractAnimeFromItem($, el));
  });

  $('#upcoming-anime .ani.items .item').each((_, el) => {
    results.upcomingAnime.push(extractAnimeFromItem($, el));
  });

  const topSections = [
    { key: 'topDay', selector: '#top-anime .tab-content[data-name="day"] .item' },
    { key: 'topWeek', selector: '#top-anime .tab-content[data-name="week"] .item' },
    { key: 'topMonth', selector: '#top-anime .tab-content[data-name="month"] .item' },
  ];

  for (const section of topSections) {
    $(section.selector).each((_, el) => {
      const $el = $(el);
      // The <a> tag is the parent of .item in top sections
      const link = $el.closest('a');
      const href = link.attr('href') || '';
      const slugMatch = href.match(/\/watch\/([^/]+)/);
      const slug = slugMatch ? slugMatch[1] : '';
      const nameEl = $el.find('.name');
      const title = nameEl.text().trim();
      const jpTitle = nameEl.attr('data-jp') || '';
      const img = $el.find('img').first();
      const thumbnail = img.attr('src') || '';
      const score = $el.find('.score, .rating').first().text().trim() || '';
      results[section.key].push({ slug, title, jpTitle, thumbnail, score, url: href.startsWith('http') ? href : `${BASE_URL}${href}` });
    });
  }

  const tableTabs = [
    { key: 'newRelease', name: 'new-release' },
    { key: 'newlyAdded', name: 'new-added' },
    { key: 'justCompleted', name: 'completed' },
  ];

  for (const tab of tableTabs) {
    $(`.top-tables section[data-name="${tab.name}"] .scaff.items .item`).each((_, el) => {
      results[tab.key].push(extractAnimeFromItem($, el));
    });
  }

  return results;
}

// ─── Home Sections (individual) ───
async function scrapeHomeSection(sectionName, page = 1) {
  const home = await scrapeHome();
  const sectionMap = {
    'latest': 'latestEpisodes',
    'upcoming': 'upcomingAnime',
    'top-day': 'topDay',
    'top-week': 'topWeek',
    'top-month': 'topMonth',
    'new-release': 'newRelease',
    'new-added': 'newlyAdded',
    'completed': 'justCompleted',
  };
  const key = sectionMap[sectionName];
  if (!key) throw new Error(`Unknown section: ${sectionName}`);
  return { section: sectionName, results: home[key] || [] };
}

// ─── Anime Detail ───
async function scrapeAnimeDetail(slugOrUrl) {
  const slug = slugOrUrl.replace(/^.*\/watch\//, '').replace(/\/$/, '');
  const $ = await fetchHTML(`/watch/${slug}`);

  const title = $('#w-info h1.title').text().trim();
  const jpTitle = $('#w-info h1.title').attr('data-jp') || '';
  const altNames = $('#w-info .names').text().trim();
  const synopsis = $('#w-info .synopsis .content').text().trim();
  const thumbnail = $('#w-info .poster img').attr('src') || '';

  const meta = {};
  $('#w-info .bmeta .meta div').each((_, el) => {
    const text = $(el).text().trim();
    const match = text.match(/^([^:]+):\s*(.+)$/s);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      meta[key] = value;
    }
  });

  const structuredMeta = normalizeMeta(meta);

  const rating = $('#w-rating .score .value span').first().text().trim() || '';
  const ratingCount = $('#w-rating [itemprop="reviewCount"]').text().trim() || '';

  // Extract anime ID from watch-main container
  const animeId = $('#watch-main').attr('data-id') || '';

  // Try to extract trailer
  let trailer = null;
  const trailerIframe = $('#w-info .trailer iframe, #trailer iframe, .trailer iframe').first();
  if (trailerIframe.length) {
    trailer = trailerIframe.attr('src') || trailerIframe.attr('data-src') || '';
  }
  const trailerLink = $('#w-info .trailer a, .trailer a').first();
  if (!trailer && trailerLink.length) {
    trailer = trailerLink.attr('href') || '';
  }

  // Related / recommendations
  const related = [];
  $('#w-related .item, .related .item, .recommendation .item, .similar .item').each((_, el) => {
    const $el = $(el);
    const link = $el.find('a').first();
    const href = link.attr('href') || '';
    const slugMatch = href.match(/\/watch\/([^/]+)/);
    const rSlug = slugMatch ? slugMatch[1] : '';
    const nameEl = $el.find('.name, .title');
    const rTitle = nameEl.text().trim();
    const rJpTitle = nameEl.attr('data-jp') || '';
    const img = $el.find('img').first();
    const rThumb = img.attr('src') || img.attr('data-src') || '';
    const rType = $el.find('.meta .right, .meta .dot').last().text().trim() || '';
    if (rSlug) {
      related.push({ slug: rSlug, title: rTitle, jpTitle: rJpTitle, thumbnail: rThumb, type: rType, url: href.startsWith('http') ? href : `${BASE_URL}${href}` });
    }
  });

  // Also try #w-related with standard item class
  if (related.length === 0) {
    $('#w-related .ani.items .item, #w-related .scaff.items .item').each((_, el) => {
      related.push(extractAnimeFromItem($, el));
    });
  }

  return {
    slug,
    animeId: animeId ? parseInt(animeId, 10) : null,
    title,
    jpTitle,
    altNames,
    synopsis,
    thumbnail,
    trailer,
    rating,
    ratingCount,
    meta,
    ...structuredMeta,
    related,
    url: `${BASE_URL}/watch/${slug}`,
  };
}

// ─── Episodes ───
async function scrapeEpisodes(animeId, slug) {
  if (!animeId) {
    throw new Error('animeId is required to scrape episodes');
  }

  const data = await fetchJSON(`/ajax/episode/list/${animeId}`, {
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': `${BASE_URL}/watch/${slug}`,
  });

  if (data.status !== 200 || !data.result) {
    throw new Error(`Failed to load episodes: ${data.result || 'unknown error'}`);
  }

  const $ = cheerio.load(data.result);
  const episodes = [];

  $('.episodes.number li a, .episodes li a').each((_, el) => {
    const $el = $(el);
    const li = $el.closest('li');

    // Try to find episode thumbnail
    const epThumb = li.find('img').attr('src') || li.find('img').attr('data-src') || '';

    const ep = {
      episodeId: parseInt($el.attr('data-id'), 10) || null,
      number: parseFloat($el.attr('data-num')) || null,
      slug: $el.attr('data-slug') || '',
      malId: parseInt($el.attr('data-mal'), 10) || null,
      timestamp: parseInt($el.attr('data-timestamp'), 10) || null,
      hasSub: $el.attr('data-sub') === '1',
      hasDub: $el.attr('data-dub') === '1',
      serverIds: $el.attr('data-ids') || '',
      title: (li.attr('title') || '').trim(),
      thumbnail: epThumb,
      active: $el.hasClass('active'),
    };
    if (ep.episodeId) episodes.push(ep);
  });

  return episodes;
}

// ─── Next Episode Estimate ───
function calculateNextEpisodeEstimate(episodes, broadcastInfo = '') {
  if (!episodes || episodes.length < 2) {
    return null;
  }

  // Sort episodes by number to get the latest ones
  const sorted = [...episodes].sort((a, b) => b.number - a.number);
  const latest = sorted[0];
  const previous = sorted[1];

  // If we have timestamps, calculate average release interval
  if (latest.timestamp && previous.timestamp) {
    const intervalMs = Math.abs(latest.timestamp - previous.timestamp) * 1000;
    const nextTimestamp = latest.timestamp + Math.floor(intervalMs / 1000);
    const nextDate = new Date(nextTimestamp * 1000);

    // Detect typical anime release patterns
    const intervalHours = intervalMs / (1000 * 60 * 60);
    let pattern = 'unknown';
    if (intervalHours < 48) pattern = 'daily';
    else if (intervalHours < 192) pattern = 'weekly';
    else if (intervalHours < 768) pattern = 'monthly';

    return {
      estimatedTime: nextDate.toISOString(),
      estimatedTimestamp: nextTimestamp,
      pattern: pattern,
      basedOn: 'release interval',
      confidence: episodes.length >= 5 ? 'high' : 'medium',
    };
  }

  // Fallback: try to parse broadcast info
  if (broadcastInfo) {
    const dayMatch = broadcastInfo.match(/(?:Aired|Broadcast):\s*([A-Za-z]+(?:\s+\d+)?)/i);
    if (dayMatch) {
      return {
        estimatedTime: null,
        pattern: 'broadcast schedule',
        schedule: dayMatch[1],
        basedOn: 'broadcast info',
        confidence: 'low',
      };
    }
  }

  return null;
}

// ─── Single Episode ───
async function scrapeEpisodeDetail(animeId, slug, episodeNumber) {
  const episodes = await scrapeEpisodes(animeId, slug);
  const ep = episodes.find(e => e.number === parseFloat(episodeNumber));
  if (!ep) {
    throw new Error(`Episode ${episodeNumber} not found`);
  }
  return ep;
}

// ─── Servers ───
async function scrapeServers(serverIds) {
  if (!serverIds) {
    throw new Error('serverIds is required');
  }

  const data = await fetchJSON(`/ajax/server/list?servers=${encodeURIComponent(serverIds)}`, {
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': BASE_URL,
  });

  if (data.status !== 200 || !data.result) {
    throw new Error(`Failed to load servers: ${data.result || 'unknown error'}`);
  }

  const $ = cheerio.load(data.result);
  const servers = [];

  $('.servers .type').each((_, typeEl) => {
    const $type = $(typeEl);
    const type = $type.attr('data-type') || 'sub';

    $type.find('ul li').each((_, el) => {
      const $el = $(el);
      servers.push({
        type,
        name: $el.text().trim(),
        serverId: $el.attr('data-sv-id') || '',
        linkId: $el.attr('data-link-id') || '',
        episodeId: parseInt($el.attr('data-ep-id'), 10) || null,
        cmId: $el.attr('data-cmid') || '',
      });
    });
  });

  return servers;
}

// ─── Video URL ───
async function scrapeVideoUrl(linkId) {
  if (!linkId) {
    throw new Error('linkId is required');
  }

  const data = await fetchJSON(`/ajax/server?get=${encodeURIComponent(linkId)}`, {
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': BASE_URL,
  });

  if (data.status !== 200 || !data.result) {
    throw new Error(`Failed to load video URL: ${data.result || 'unknown error'}`);
  }

  return {
    url: data.result.url || '',
    skipData: data.result.skip_data || null,
    raw: data.result,
  };
}

// ─── Full episode pipeline (details + episodes + servers + video URLs) ───
async function scrapeAnimeWithEpisodes(slugOrUrl, options = {}) {
  const { includeServers = false, includeVideoUrls = false, delayMs = 800, limit = 0 } = options;

  const detail = await scrapeAnimeDetail(slugOrUrl);
  if (!detail.animeId) {
    throw new Error(`Could not extract animeId from detail page for ${slugOrUrl}`);
  }

  console.log(`  Scraping ${detail.title} episodes...`);
  let episodes = await scrapeEpisodes(detail.animeId, detail.slug);
  if (limit > 0 && episodes.length > limit) {
    console.log(`  Limiting to first ${limit} episodes (out of ${episodes.length})`);
    episodes = episodes.slice(0, limit);
  }

  const enrichedEpisodes = [];
  for (const ep of episodes) {
    const enriched = { ...ep };

    if (includeServers && ep.serverIds) {
      await sleep(delayMs);
      try {
        const servers = await scrapeServers(ep.serverIds);
        enriched.servers = servers;

        if (includeVideoUrls) {
          enriched.videoUrls = [];
          for (const srv of servers) {
            if (srv.linkId) {
              await sleep(delayMs);
              try {
                const video = await scrapeVideoUrl(srv.linkId);
                enriched.videoUrls.push({
                  serverName: srv.name,
                  type: srv.type,
                  url: video.url,
                  skipData: video.skipData,
                });
              } catch (err) {
                enriched.videoUrls.push({
                  serverName: srv.name,
                  type: srv.type,
                  error: err.message,
                });
              }
            }
          }
        }
      } catch (err) {
        enriched.serverError = err.message;
      }
    }

    enrichedEpisodes.push(enriched);
  }

  return {
    ...detail,
    episodes: enrichedEpisodes,
    episodeCount: enrichedEpisodes.length,
  };
}

// ─── Search ───
async function searchAnime(keyword, page = 1) {
  const url = `/filter?keyword=${encodeURIComponent(keyword)}${page > 1 ? `&page=${page}` : ''}`;
  const $ = await fetchHTML(url);
  const results = [];

  $('.ani.items .item').each((_, el) => {
    results.push(extractAnimeFromItem($, el));
  });

  if (results.length === 0) {
    $('.item').each((_, el) => {
      const $el = $(el);
      if ($el.find('.poster, .ani').length > 0) {
        results.push(extractAnimeFromItem($, el));
      }
    });
  }

  const pagination = extractPagination($);

  return { results, page, ...pagination };
}

// ─── Genre ───
async function scrapeGenre(genre, page = 1) {
  const url = `/genre/${encodeURIComponent(genre.toLowerCase())}${page > 1 ? `?page=${page}` : ''}`;
  const $ = await fetchHTML(url);
  const results = [];

  $('.ani.items .item').each((_, el) => {
    results.push(extractAnimeFromItem($, el));
  });

  const pagination = extractPagination($);

  return { results, page, genre, ...pagination };
}

// ─── A-Z List ───
async function scrapeAZList(letter = '', page = 1, limit = 0) {
  // 'all', '', or 'ALL' should use the base /az-list endpoint
  const isAll = !letter || letter.toLowerCase() === 'all';
  const url = isAll
    ? `/az-list${page > 1 ? `?page=${page}` : ''}`
    : `/az-list/${encodeURIComponent(letter.toUpperCase())}${page > 1 ? `?page=${page}` : ''}`;
  
  const $ = await fetchHTML(url);
  const results = [];

  $('.ani.items .item').each((_, el) => {
    results.push(extractAnimeFromItem($, el));
  });

  const pagination = extractPagination($);

  // Apply limit if specified
  const limitedResults = limit > 0 ? results.slice(0, limit) : results;

  return { 
    results: limitedResults, 
    page, 
    letter: isAll ? 'all' : letter.toUpperCase(),
    limit: limit > 0 ? limit : results.length,
    total: results.length,
    ...pagination 
  };
}

// ─── Get All Animes (fetches all pages) ───
async function scrapeAllAnimes(maxPages = 0) {
  const allResults = [];
  let page = 1;
  let hasMore = true;
  
  console.log('Fetching all animes...');
  
  while (hasMore) {
    const data = await scrapeAZList('', page);
    allResults.push(...data.results);
    console.log(`  Page ${page}: ${data.results.length} animes (total: ${allResults.length})`);
    
    hasMore = data.hasNextPage && (maxPages === 0 || page < maxPages);
    page++;
    
    // Rate limiting - be nice to the server
    if (hasMore) {
      await sleep(500);
    }
  }
  
  return { 
    results: allResults, 
    total: allResults.length,
    pages: page - 1,
    letter: 'all'
  };
}

// ─── Genres List ───
async function scrapeGenres() {
  try {
    const $ = await fetchHTML('/home');
    const genres = [];

    // Try sidebar or footer genre links
    $('a[href^="/genre/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/\/genre\/([^/?]+)/);
      if (match) {
        const name = match[1];
        const label = $(el).text().trim() || name;
        if (!genres.find(g => g.slug === name)) {
          genres.push({ slug: name, name: label });
        }
      }
    });

    // Also try a dedicated genre page if it exists
    if (genres.length === 0) {
      const $g = await fetchHTML('/genre');
      $g('a[href^="/genre/"]').each((_, el) => {
        const href = $g(el).attr('href') || '';
        const match = href.match(/\/genre\/([^/?]+)/);
        if (match) {
          const name = match[1];
          const label = $g(el).text().trim() || name;
          if (!genres.find(g => g.slug === name)) {
            genres.push({ slug: name, name: label });
          }
        }
      });
    }

    // Fallback: common anime genres
    if (genres.length === 0) {
      const common = [
        'action','adventure','cars','comedy','crime','dementia','demons','drama','ecchi','family',
        'fantasy','game','gender-bender','gore','harem','historical','horror','isekai','josei',
        'kids','magic','martial-arts','mecha','military','music','mystery','parody','police',
        'psychological','romance','samurai','school','sci-fi','seinen','shoujo','shoujo-ai',
        'shounen','shounen-ai','slice-of-life','space','sports','super-power','supernatural',
        'suspense','thriller','vampire','yaoi','yuri'
      ];
      common.forEach(g => genres.push({ slug: g, name: g.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }));
    }

    return genres;
  } catch (err) {
    console.error('Failed to scrape genres:', err.message);
    return [];
  }
}

// ─── Helpers ───
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9\-_]/gi, '-').replace(/-+/g, '-').toLowerCase();
}

async function saveJSON(filename, data) {
  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const filepath = path.join(outDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Saved: ${filepath}`);
}

// ─── CLI ───
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'home';

  try {
    switch (command) {
      case 'home': {
        console.log('Scraping homepage...');
        const data = await scrapeHome();
        await saveJSON('home.json', data);
        console.log(`Latest episodes: ${data.latestEpisodes.length}`);
        console.log(`Upcoming: ${data.upcomingAnime.length}`);
        console.log(`Top day: ${data.topDay.length}`);
        break;
      }

      case 'anime': {
        const slug = args[1];
        if (!slug) {
          console.log('Usage: node scraper.js anime <slug>');
          process.exit(1);
        }
        console.log(`Scraping anime: ${slug}`);
        const data = await scrapeAnimeDetail(slug);
        await saveJSON(`${sanitizeFilename(slug)}.json`, data);
        console.log(`Title: ${data.title}`);
        console.log(`Rating: ${data.rating}`);
        console.log(`Anime ID: ${data.animeId}`);
        console.log(`Genres: ${(data.genres || []).join(', ')}`);
        console.log(`Related: ${(data.related || []).length}`);
        break;
      }

      case 'episodes': {
        const slug = args[1];
        if (!slug) {
          console.log('Usage: node scraper.js episodes <slug>');
          process.exit(1);
        }
        console.log(`Scraping episodes for: ${slug}`);
        const detail = await scrapeAnimeDetail(slug);
        if (!detail.animeId) {
          console.error('Could not extract animeId from detail page');
          process.exit(1);
        }
        const episodes = await scrapeEpisodes(detail.animeId, detail.slug);
        await saveJSON(`${sanitizeFilename(slug)}-episodes.json`, { anime: detail.title, animeId: detail.animeId, episodes });
        console.log(`Episodes: ${episodes.length}`);
        break;
      }

      case 'servers': {
        const serverIds = args[1];
        if (!serverIds) {
          console.log('Usage: node scraper.js servers <server-ids>');
          process.exit(1);
        }
        console.log('Scraping servers...');
        const servers = await scrapeServers(serverIds);
        await saveJSON('servers.json', servers);
        console.log(`Servers: ${servers.length}`);
        break;
      }

      case 'video': {
        const linkId = args[1];
        if (!linkId) {
          console.log('Usage: node scraper.js video <link-id>');
          process.exit(1);
        }
        console.log('Scraping video URL...');
        const video = await scrapeVideoUrl(linkId);
        console.log('Video URL:', video.url);
        await saveJSON('video.json', video);
        break;
      }

      case 'full': {
        const slug = args[1];
        if (!slug) {
          console.log('Usage: node scraper.js full <slug> [--servers] [--videos] [--limit N]');
          process.exit(1);
        }
        const includeServers = args.includes('--servers');
        const includeVideoUrls = args.includes('--videos');
        const limitIdx = args.indexOf('--limit');
        const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) || 0 : 0;

        console.log(`Scraping full data for: ${slug}`);
        if (includeServers) console.log('  Including server lists');
        if (includeVideoUrls) console.log('  Including video URLs');
        if (limit > 0) console.log(`  Limiting to ${limit} episodes`);

        const data = await scrapeAnimeWithEpisodes(slug, { includeServers, includeVideoUrls, limit });
        await saveJSON(`${sanitizeFilename(slug)}-full.json`, data);
        console.log(`\nTitle: ${data.title}`);
        console.log(`Episodes: ${data.episodeCount}`);
        console.log(`Genres: ${(data.genres || []).join(', ')}`);
        console.log(`Related: ${(data.related || []).length}`);
        if (includeServers && data.episodes.length > 0) {
          const firstWithServers = data.episodes.find(ep => ep.servers && ep.servers.length > 0);
          if (firstWithServers) {
            console.log(`Servers for Ep ${firstWithServers.number}: ${firstWithServers.servers.length}`);
          }
        }
        break;
      }

      case 'search': {
        const keyword = args.slice(1).join(' ');
        if (!keyword) {
          console.log('Usage: node scraper.js search <keyword> [page]');
          process.exit(1);
        }
        const page = parseInt(args[args.length - 1], 10) || 1;
        const actualKeyword = isNaN(parseInt(args[args.length - 1], 10)) ? args.slice(1).join(' ') : args.slice(1, -1).join(' ');
        const actualPage = isNaN(parseInt(args[args.length - 1], 10)) ? 1 : parseInt(args[args.length - 1], 10);

        console.log(`Searching for: ${actualKeyword} (page ${actualPage})`);
        const data = await searchAnime(actualKeyword, actualPage);
        await saveJSON(`search-${sanitizeFilename(actualKeyword)}-p${actualPage}.json`, data);
        console.log(`Results: ${data.results.length}, hasNextPage: ${data.hasNextPage}, totalPages: ${data.totalPages}`);
        break;
      }

      case 'genre': {
        const genre = args[1];
        const page = parseInt(args[2], 10) || 1;
        if (!genre) {
          console.log('Usage: node scraper.js genre <genre> [page]');
          process.exit(1);
        }
        console.log(`Scraping genre: ${genre} (page ${page})`);
        const data = await scrapeGenre(genre, page);
        await saveJSON(`genre-${sanitizeFilename(genre)}-p${page}.json`, data);
        console.log(`Results: ${data.results.length}, hasNextPage: ${data.hasNextPage}, totalPages: ${data.totalPages}`);
        break;
      }

      case 'genres': {
        console.log('Scraping genre list...');
        const data = await scrapeGenres();
        await saveJSON('genres.json', data);
        console.log(`Genres: ${data.length}`);
        break;
      }

      case 'az': {
        const letter = args[1] || '';
        const page = parseInt(args[2], 10) || 1;
        console.log(`Scraping A-Z list: ${letter || 'All'} (page ${page})`);
        const data = await scrapeAZList(letter, page);
        await saveJSON(`az-${letter || 'all'}-p${page}.json`, data);
        console.log(`Results: ${data.results.length}, hasNextPage: ${data.hasNextPage}, totalPages: ${data.totalPages}`);
        break;
      }

      default: {
        console.log(`
Anikoto Scraper
Usage:
  node scraper.js home                       - Scrape homepage
  node scraper.js anime <slug>               - Scrape anime details
  node scraper.js episodes <slug>            - Scrape episode list
  node scraper.js servers <server-ids>     - Scrape servers for an episode
  node scraper.js video <link-id>            - Scrape video stream URL
  node scraper.js full <slug> [--servers] [--videos]
                                             - Scrape anime + episodes + servers + video URLs
  node scraper.js search <keyword> [page]    - Search anime (supports pagination)
  node scraper.js genre <genre> [page]       - Scrape by genre (supports pagination)
  node scraper.js genres                     - List all available genres
  node scraper.js az [letter] [page]         - Scrape A-Z list (supports pagination)
        `);
      }
    }
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
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
  scrapeAllAnimes,
  scrapeGenres,
  calculateNextEpisodeEstimate,
  BASE_URL,
};
