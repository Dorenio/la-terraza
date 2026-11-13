const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const publicDirectory = __dirname;
const port = Number(process.env.PORT) || 3000;
const contentTypes = {
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4'
};

const server = http.createServer((request, response) => {
  const requestPath = decodeURIComponent(request.url.split('?')[0]);
  const host = request.headers.host || 'localhost';
  const forwardedProto = (request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const origin = (process.env.SITE_URL || `${forwardedProto || (request.socket.encrypted ? 'https' : 'http')}://${host}`).replace(/\/$/, '');
  const publicPages = [
    '/', '/nosotros.html', '/carta.html', '/eventos.html', '/cumpleanos-infantiles.html'
  ];

  if (requestPath === '/robots.txt') {
    response.writeHead(200, { 'Content-Type': contentTypes['.txt'], 'Cache-Control': 'public, max-age=3600' });
    response.end(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
    return;
  }

  if (requestPath === '/sitemap.xml') {
    const urls = publicPages.map((page) => `  <url><loc>${origin}${page === '/' ? '/' : page}</loc></url>`).join('\n');
    response.writeHead(200, { 'Content-Type': contentTypes['.xml'], 'Cache-Control': 'public, max-age=3600' });
    response.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
    return;
  }
  if (requestPath === '/galeria.html') {
    response.writeHead(301, { Location: '/nosotros.html#galeria' });
    response.end();
    return;
  }
  const requestedFile = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.resolve(publicDirectory, `.${requestedFile}`);

  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const isAsset = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico', '.mp4'].includes(extension);
    const headers = {
      'Content-Type': contentTypes[extension] || 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=2592000' : 'no-cache'
    };

    if (extension === '.mp4') {
      headers['Accept-Ranges'] = 'bytes';
      const rangeHeader = request.headers.range;
      const range = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);

      if (rangeHeader && !range) {
        response.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
        response.end();
        return;
      }

      if (range) {
        const size = stats.size;
        let start = range[1] ? Number(range[1]) : null;
        let end = range[2] ? Number(range[2]) : null;

        if (start === null) {
          const suffixLength = end;
          start = Math.max(size - suffixLength, 0);
          end = size - 1;
        } else {
          end = end === null ? size - 1 : Math.min(end, size - 1);
        }

        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
          response.writeHead(416, { 'Content-Range': `bytes */${size}` });
          response.end();
          return;
        }

        response.writeHead(206, {
          ...headers,
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${size}`
        });
        fs.createReadStream(filePath, { start, end }).pipe(response);
        return;
      }
    }

    const compressible = ['.html', '.css', '.js', '.svg'].includes(extension)
      && /\bgzip\b/.test(request.headers['accept-encoding'] || '');

    if (extension === '.html') {
      const pagePath = requestedFile === '/index.html' ? '/' : requestedFile;
      const canonical = `${origin}${pagePath}`;
      const pageTitle = fs.readFileSync(filePath, 'utf8').match(/<title>([^<]*)<\/title>/i)?.[1] || 'La Terraza · Otura, Granada';
      const pageDescription = fs.readFileSync(filePath, 'utf8').match(/<meta\s+name="description"\s+content="([^"]*)"\s*\/?\s*>/i)?.[1] || 'Restaurante La Terraza en Otura, Granada.';
      const socialMeta = `\n  <meta name="robots" content="index,follow,max-image-preview:large" />\n  <link rel="canonical" href="${canonical}" />\n  <meta property="og:type" content="website" />\n  <meta property="og:locale" content="es_ES" />\n  <meta property="og:site_name" content="La Terraza · Otura" />\n  <meta property="og:title" content="${pageTitle}" />\n  <meta property="og:description" content="${pageDescription}" />\n  <meta property="og:url" content="${canonical}" />`;
      const restaurantSchema = pagePath === '/' ? `\n  <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Restaurant', name: 'La Terraza',
        description: 'Restaurante familiar en Otura, Granada, con terraza, salones, cocina mediterránea, zona infantil y celebraciones.',
        url: canonical, telephone: '+34 623 112 264',
        image: `${origin}/assets/portada-restaurante.jpg`,
        address: { '@type': 'PostalAddress', streetAddress: 'Carretera Otura-Dílar s/n', postalCode: '18630', addressLocality: 'Otura', addressRegion: 'Granada', addressCountry: 'ES' },
        geo: { '@type': 'GeoCoordinates', latitude: 37.0891756, longitude: -3.6273285 },
        servesCuisine: ['Cocina mediterránea', 'Pizza'], priceRange: '€€', hasMenu: `${origin}/carta.html`,
        sameAs: ['https://www.instagram.com/la_terraza_otura/', 'https://www.facebook.com/LATERRAZAOTURA/']
      })}</script>` : '';
      fs.readFile(filePath, 'utf8', (readError, source) => {
        if (readError) {
          response.writeHead(500);
          response.end('Internal server error');
          return;
        }
        const html = source.replace('</head>', `${socialMeta}${restaurantSchema}\n</head>`);
        if (compressible) {
          headers['Content-Encoding'] = 'gzip';
          headers.Vary = 'Accept-Encoding';
          response.writeHead(200, headers);
          response.end(zlib.gzipSync(html));
          return;
        }
        response.writeHead(200, headers);
        response.end(html);
      });
      return;
    }

    if (compressible) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      response.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(response);
      return;
    }

    headers['Content-Length'] = stats.size;
    response.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`La Terraza listening on port ${port}`);
});
