# Deploy to Vercel

## Quick Deploy

1. **Install Vercel CLI** (optional):
   ```bash
   npm install -g vercel
   ```

2. **Deploy**:
   ```bash
   vercel
   ```
   
   Or use the Vercel web dashboard:
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repo
   - Deploy

## Project Structure

```
anikoto-scraper/
├── api/
│   ├── [...slug].js    # Main API handler (all routes)
│   └── docs.js         # Docs endpoint
├── scraper.js          # Core scraping logic
├── vercel.json         # Vercel configuration
├── package.json
└── README.md
```

## API Endpoints

| Endpoint | Description | Timeout |
|----------|-------------|---------|
| `GET /api/home` | Homepage data | ~5s |
| `GET /api/anime/:slug` | Anime details | ~3s |
| `GET /api/anime/:slug/episodes` | Episodes + next estimate | ~5s |
| `GET /api/anime/:slug/full` | Full data (with servers) | ~60s ⚠️ |
| `GET /api/search?keyword=X` | Search | ~3s |
| `GET /api/genre/:name` | Genre listing | ~3s |
| `GET /api/genres` | All genres | ~2s |
| `GET /api/az-list` | A-Z list | ~3s |

## Important Notes

### ⚠️ Timeout Limits
- **Hobby**: 10 seconds max
- **Pro**: 60 seconds max
- Avoid `full` endpoint with `servers=true&videos=true` on Hobby plan

### ⚠️ Rate Limiting
Vercel doesn't provide built-in rate limiting. Add your own:
- Use `@vercel/kv` for Redis-based limiting
- Or add Cloudflare in front

### ⚠️ Cold Starts
First request after inactivity may take 2-5 seconds. Subsequent requests are faster.

## Environment Variables (Optional)

```env
# Add in Vercel dashboard if needed
NODE_ENV=production
```

## Testing Locally

```bash
# Install Vercel CLI
npm install -g vercel

# Run locally with Vercel environment
vercel dev

# Test endpoints
curl http://localhost:3000/api/home
curl http://localhost:3000/api/anime/one-piece-odmau/episodes
```

## Example Usage

```javascript
// Get homepage
fetch('https://your-app.vercel.app/api/home')
  .then(r => r.json())
  .then(console.log);

// Get episodes with next estimate
fetch('https://your-app.vercel.app/api/anime/one-piece-odmau/episodes')
  .then(r => r.json())
  .then(data => {
    console.log('Next episode:', data.data.nextEpisodeEstimate.estimatedTime);
  });

// Search
fetch('https://your-app.vercel.app/api/search?keyword=naruto')
  .then(r => r.json())
  .then(console.log);
```

## Troubleshooting

### "Function invocation failed"
- Check Vercel function logs in dashboard
- Likely timeout - reduce `limit` parameter or avoid `full` endpoint

### "Module not found"
- Ensure all dependencies are in `package.json`
- Run `npm install` before deploying

### CORS errors
- CORS headers are set in the API handler
- If using custom domain, update allowed origins
