// server.js
const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const crypto = require('crypto');
const Redis = require('ioredis');
const rateLimit = require('express-rate-limit'); // New package

const app = express();
const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.DOMAIN || 'http://localhost:3000';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const GITHUB_URL = process.env.GITHUB_URL || 'https://github.com/your-username/pulse'; // Add your repo here later

// Admin Credentials
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

// --- DATABASE INIT ---
const db = new Database('data/counter.db');
db.pragma('journal_mode = WAL');

// Initialize Redis
const redis = new Redis({ host: REDIS_HOST });

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS visits (
    site_id TEXT,
    count INTEGER DEFAULT 0,
    unique_count INTEGER DEFAULT 0,
    PRIMARY KEY (site_id)
  );
`);

// Migration
try { db.prepare('ALTER TABLE visits ADD COLUMN unique_count INTEGER DEFAULT 0').run(); } catch (e) {}

app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1); 

// --- RATE LIMITER (Creation Only) ---
// Protects your DB from bots creating 1000s of sites
const createLimiter = rateLimit({
	windowMs: 60 * 60 * 1000, // 1 hour
	max: 10, // Limit each IP to 10 created agents per hour
	message: "Too many agents created from this IP, please try again later."
});

// --- BACKGROUND SYNC WORKER ---
setInterval(async () => {
    try {
        const activeSites = await redis.smembers('dirty_sites');
        if (activeSites.length === 0) return;
        
        const updateStmt = db.prepare('UPDATE visits SET count = count + ?, unique_count = unique_count + ? WHERE site_id = ?');
        const transaction = db.transaction((updates) => {
            for (const update of updates) { updateStmt.run(update.views, update.uniques, update.id); }
        });

        const updates = [];
        for (const siteId of activeSites) {
            const views = await redis.getset(`buffer:total:${siteId}`, 0);
            const uniques = await redis.getset(`buffer:unique:${siteId}`, 0);
            if (views > 0 || uniques > 0) {
                updates.push({ id: siteId, views: parseInt(views) || 0, uniques: parseInt(uniques) || 0 });
            }
        }
        if (updates.length > 0) transaction(updates);
        await redis.del('dirty_sites');
    } catch (e) { console.error("Sync Error:", e); }
}, 10000);

// --- AUTH MIDDLEWARE ---
const checkAuth = (req, res, next) => {
    if (!process.env.ADMIN_PASS) return next();
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    if (login && password && login === ADMIN_USER && password === ADMIN_PASS) return next();
    res.set('WWW-Authenticate', 'Basic realm="P.U.L.S.E. Admin Area"');
    res.status(401).send('Restricted Access');
};

// --- LOGIC: TRACKING ---
async function trackVisit(siteId, req) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    const visitorHash = crypto.createHash('md5').update(`${ip}:${ua}`).digest('hex');

    await redis.incr(`buffer:total:${siteId}`);
    const isNew = await redis.pfadd(`hll:${siteId}`, visitorHash);
    if (isNew === 1) await redis.incr(`buffer:unique:${siteId}`);
    await redis.sadd('dirty_sites', siteId);
}

// --- HELPER: SVG ICONS ---
const ICONS = {
    eye: '<path d="M10.5 8a2.5 2.5 0 1 1-2.5 2.5A2.5 2.5 0 0 1 10.5 8z"/><path fill-rule="evenodd" d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/>',
    user: '<path d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>',
    star: '<path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/>',
    heart: '<path fill-rule="evenodd" d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/>',
    fire: '<path d="M8 16c3.314 0 6-2 6-5.5 0-1.5-.5-4-2.5-6 .25 1.5-1.25 2-1.25 2C11 4 9 .5 6 0c.357 2 .5 4-2 6-1.25 1-2 2.729-2 4.5C2 14 4.686 16 8 16z"/>',
    none: ''
};

function generateBadge(total, unique, query) {
    const { 
        label = 'Views', color = '4c1', labelColor = '555', 
        style = 'flat', icon = 'none', mode = 'both'
    } = query;

    let valueText = '';
    if (mode === 'unique') valueText = `${unique}`;
    else if (mode === 'views' || mode === 'total') valueText = `${total}`;
    else valueText = `${total} / ${unique}`;

    const iconWidth = (icon !== 'none' && ICONS[icon]) ? 13 : 0;
    const labelWidth = (label.length * 7) + 10 + iconWidth; 
    const valueWidth = (valueText.length * 7.5) + 10;
    const totalWidth = labelWidth + valueWidth;

    const rx = (style === 'flat-square') ? 0 : 3;
    const iconSvg = (iconWidth > 0) ? `<svg x="4" y="3" width="14" height="14" viewBox="0 0 16 16" fill="#fff">${ICONS[icon]}</svg>` : '';
    const labelX = (labelWidth / 2) + (iconWidth / 2) + 1;
    const valueX = labelWidth + (valueWidth / 2);
    const overlay = (style === 'plastic') ? `<linearGradient id="g" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".1" stop-color="#aaa" stop-opacity=".1"/><stop offset=".9" stop-opacity=".2"/><stop offset="1" stop-opacity=".2"/></linearGradient><rect width="${totalWidth}" height="20" rx="${rx}" fill="url(#g)"/>` : '';
    const fixHex = (h) => (h || '').replace('#', '');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20"><linearGradient id="b" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><mask id="a"><rect width="${totalWidth}" height="20" rx="${rx}" fill="#fff"/></mask><g mask="url(#a)"><path fill="#${fixHex(labelColor)}" d="M0 0h${labelWidth}v20H0z"/><path fill="#${fixHex(color)}" d="M${labelWidth} 0h${valueWidth}v20H${labelWidth}z"/><path fill="url(#b)" d="M0 0h${totalWidth}v20H0z"/></g>${overlay}${iconSvg}<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11"><text x="${labelX}" y="15" fill="#010101" fill-opacity=".3">${label}</text><text x="${labelX}" y="14">${label}</text><text x="${valueX}" y="15" fill="#010101" fill-opacity=".3">${valueText}</text><text x="${valueX}" y="14">${valueText}</text></g></svg>`;
}

// --- SECURED DASHBOARD ROUTES ---

app.get('/', checkAuth, async (req, res) => {
    const sites = db.prepare('SELECT * FROM sites JOIN visits ON sites.id = visits.site_id ORDER BY created_at DESC').all();
    
    // Simple Server Load Metric
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    
    for (let site of sites) {
        const bufTotal = await redis.get(`buffer:total:${site.id}`);
        const bufUnique = await redis.get(`buffer:unique:${site.id}`);
        site.live_count = site.count + (parseInt(bufTotal) || 0);
        site.live_unique = site.unique_count + (parseInt(bufUnique) || 0);
    }

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>P.U.L.S.E. Open Source</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
            tailwind.config = { theme: { extend: { colors: { slate: { 850: '#151f2e' } } } } }
            
            let activeSiteId = '';

            function openDesigner(siteId) {
                activeSiteId = siteId;
                document.getElementById('modal').classList.remove('hidden');
                document.getElementById('modal-site-id').innerText = siteId;
                updatePreview();
            }

            function closeDesigner() { document.getElementById('modal').classList.add('hidden'); }

            function updatePreview() {
                if(!activeSiteId) return;
                const params = new URLSearchParams();
                const ids = ['label', 'color', 'label-color', 'style', 'icon', 'mode'];
                ids.forEach(id => {
                    const el = document.getElementById('input-'+id);
                    if(el && el.value) params.append(id.replace('-',''), el.value.replace('#',''));
                });
                const url = '${DOMAIN}/badge/' + activeSiteId + '?' + params.toString();
                document.getElementById('preview-img').src = url;
                document.getElementById('code-result').innerText = '![](' + url + ')';
            }

            function copyCode() {
                const text = document.getElementById('code-result').innerText;
                navigator.clipboard.writeText(text).then(() => {
                    const btn = document.getElementById('copy-btn');
                    btn.innerText = 'Copied!';
                    setTimeout(() => btn.innerText = 'Copy Markdown', 2000);
                });
            }
        </script>
    </head>
    <body class="bg-slate-950 text-slate-200 min-h-screen font-sans flex flex-col">
        
        <!-- Notice Banner -->
        <div class="bg-blue-900/30 border-b border-blue-900/50 py-2 text-center text-xs font-mono text-blue-300">
            <span class="mr-2">ℹ️ COMMUNITY HOSTED INSTANCE</span>
            <span>For high-traffic production use, please <a href="${GITHUB_URL}" class="underline hover:text-white" target="_blank">Self-Host</a>.</span>
        </div>

        <!-- Navbar -->
        <nav class="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-40">
            <div class="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
                <div class="flex items-center gap-3">
                    <div class="h-3 w-3 rounded-full bg-blue-500 animate-pulse"></div>
                    <h1 class="text-xl font-bold tracking-tight text-white">P.U.L.S.E. <span class="text-slate-500 font-normal text-sm">/ DASHBOARD</span></h1>
                </div>
                <div class="flex items-center gap-4 text-xs font-mono hidden md:flex">
                    <span class="text-slate-500">RAM: ${Math.round(memoryUsage)}MB</span>
                    <span class="text-green-400 bg-green-900/20 px-2 py-1 rounded border border-green-900/50">SYSTEM HEALTHY</span>
                </div>
            </div>
        </nav>

        <main class="max-w-5xl mx-auto px-6 py-10 flex-1 w-full">
            
            <!-- Create Section -->
            <div class="mb-12">
                <div class="bg-gradient-to-r from-blue-900/20 to-slate-900/50 rounded-2xl border border-blue-900/30 p-8">
                    <h2 class="text-2xl font-semibold text-white mb-2">Deploy Free Agent</h2>
                    <p class="text-slate-400 mb-6 text-sm max-w-lg">
                        Create a tracking agent for your GitHub repository or personal site. 
                        <br/><span class="text-slate-500 italic">Limited to personal use to conserve server resources.</span>
                    </p>
                    <form action="/create" method="POST" class="flex gap-3 mt-4">
                        <input type="text" name="name" placeholder="Project Name..." required
                            class="flex-1 bg-slate-900 border border-slate-700 text-white px-4 py-3 rounded-lg focus:ring-1 focus:ring-blue-500 transition shadow-inner">
                        <button type="submit" class="bg-blue-600 hover:bg-blue-500 text-white font-medium px-8 py-3 rounded-lg transition shadow-lg">Initialize</button>
                    </form>
                </div>
            </div>

            <!-- Site List -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                ${sites.map(s => `
                <div class="bg-slate-900 rounded-xl border border-slate-800 hover:border-blue-500/50 transition-all duration-300 shadow-xl flex flex-col group relative overflow-hidden">
                    <div class="p-5 flex justify-between items-start z-10">
                        <div>
                            <h3 class="font-bold text-lg text-white group-hover:text-blue-400 transition truncate w-32">${s.name}</h3>
                            <p class="text-[10px] font-mono text-slate-500 mt-1 uppercase">ID: ${s.id}</p>
                        </div>
                        <div class="text-right">
                            <div class="text-2xl font-mono font-bold text-white">${s.live_count.toLocaleString()}</div>
                            <div class="text-[10px] text-slate-500 uppercase">Hits</div>
                        </div>
                    </div>
                    
                    <div class="px-5 pb-4 z-10 h-8 flex items-center">
                        <img src="${DOMAIN}/badge/${s.id}?style=flat-square&color=2563eb" class="max-h-5 opacity-70 group-hover:opacity-100 transition" />
                    </div>

                    <div class="mt-auto border-t border-slate-800 bg-slate-950/50 p-3 z-10">
                        <button onclick="openDesigner('${s.id}')" class="w-full bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white text-xs font-bold py-2 rounded transition">
                            OPEN DESIGNER &rarr;
                        </button>
                    </div>
                </div>`).join('')}
            </div>
            
            ${sites.length === 0 ? '<div class="text-center py-20 opacity-50"><p>No agents active.</p></div>' : ''}
        </main>

        <!-- Footer -->
        <footer class="border-t border-slate-800 bg-slate-900 py-8 mt-12">
            <div class="max-w-5xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center text-sm text-slate-500">
                <div class="mb-4 md:mb-0">
                    <p class="font-bold text-slate-400">P.U.L.S.E. System</p>
                    <p class="text-xs">Open Source Analytics</p>
                </div>
                <div class="flex gap-6">
                    <a href="${GITHUB_URL}" target="_blank" class="hover:text-white transition flex items-center gap-2">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                        Get Source Code
                    </a>
                    <a href="#" class="hover:text-white transition">Donate / Sponsor</a>
                </div>
            </div>
        </footer>

        <!-- DESIGNER MODAL -->
        <div id="modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div class="bg-slate-900 w-full max-w-2xl rounded-2xl border border-slate-700 shadow-2xl overflow-hidden">
                <div class="bg-slate-950 p-6 border-b border-slate-800 flex justify-between items-center">
                    <div><h3 class="text-xl font-bold text-white">Badge Designer</h3></div>
                    <button onclick="closeDesigner()" class="text-slate-400 hover:text-white text-2xl">&times;</button>
                </div>
                <div class="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div class="space-y-4">
                        <div><label class="block text-xs font-bold text-slate-500 mb-1">LABEL TEXT</label><input type="text" id="input-label" value="Views" oninput="updatePreview()" class="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"></div>
                        <div class="grid grid-cols-2 gap-4">
                            <div><label class="block text-xs font-bold text-slate-500 mb-1">RIGHT COLOR</label><input type="color" id="input-color" value="#44cc11" oninput="updatePreview()" class="w-full h-9 bg-slate-800 border border-slate-700 rounded p-1"></div>
                            <div><label class="block text-xs font-bold text-slate-500 mb-1">LEFT COLOR</label><input type="color" id="input-label-color" value="#555555" oninput="updatePreview()" class="w-full h-9 bg-slate-800 border border-slate-700 rounded p-1"></div>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div><label class="block text-xs font-bold text-slate-500 mb-1">STYLE</label><select id="input-style" onchange="updatePreview()" class="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"><option value="flat">Flat</option><option value="flat-square">Flat Square</option><option value="plastic">Plastic</option></select></div>
                            <div><label class="block text-xs font-bold text-slate-500 mb-1">ICON</label><select id="input-icon" onchange="updatePreview()" class="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"><option value="none">None</option><option value="eye">Eye</option><option value="user">User</option><option value="star">Star</option><option value="heart">Heart</option><option value="fire">Fire</option></select></div>
                        </div>
                        <div><label class="block text-xs font-bold text-slate-500 mb-1">DATA MODE</label><select id="input-mode" onchange="updatePreview()" class="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"><option value="both">Views / Unique</option><option value="views">Total Views Only</option><option value="unique">Unique Only</option></select></div>
                    </div>
                    <div class="bg-slate-950 rounded-xl border border-slate-800 p-6 flex flex-col items-center justify-center text-center">
                        <p class="text-xs font-bold text-slate-500 mb-4">LIVE PREVIEW</p>
                        <div class="mb-8 transform scale-150"><img id="preview-img" src="" alt="Preview"></div>
                        <div class="w-full text-left">
                            <label class="block text-xs font-bold text-slate-500 mb-1">MARKDOWN CODE</label>
                            <div class="bg-black/50 border border-slate-800 rounded p-3 mb-2 overflow-x-auto"><code id="code-result" class="text-xs font-mono text-blue-300 whitespace-nowrap">...</code></div>
                            <button id="copy-btn" onclick="copyCode()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded text-xs transition">Copy Markdown</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>`);
});

app.post('/create', checkAuth, createLimiter, (req, res) => {
    const id = crypto.randomUUID().slice(0, 8);
    const run = db.transaction(() => {
        db.prepare('INSERT INTO sites (id, name) VALUES (?, ?)').run(id, req.body.name);
        db.prepare('INSERT INTO visits (site_id, count, unique_count) VALUES (?, 0, 0)').run(id);
    });
    run();
    res.redirect('/');
});

app.get('/badge/:id', async (req, res) => {
    const { id } = req.params;
    await trackVisit(id, req);
    const dbData = db.prepare('SELECT count, unique_count FROM visits WHERE site_id = ?').get(id);
    const bufTotal = await redis.get(`buffer:total:${id}`);
    const bufUnique = await redis.get(`buffer:unique:${id}`);
    const total = (dbData ? dbData.count : 0) + (parseInt(bufTotal) || 0);
    const unique = (dbData ? dbData.unique_count : 0) + (parseInt(bufUnique) || 0);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(generateBadge(total, unique, req.query));
});

app.get('/track/:id', async (req, res) => {
    const { id } = req.params;
    await trackVisit(id, req);
    const dbData = db.prepare('SELECT count, unique_count FROM visits WHERE site_id = ?').get(id);
    const bufTotal = await redis.get(`buffer:total:${id}`);
    const bufUnique = await redis.get(`buffer:unique:${id}`);
    res.json({ count: (dbData ? dbData.count : 0) + (parseInt(bufTotal) || 0), unique: (dbData ? dbData.unique_count : 0) + (parseInt(bufUnique) || 0) });
});

app.get('/client.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`(function(){try{const s=document.querySelector('script[data-site-id]');if(!s)return;fetch('${DOMAIN}/track/'+s.getAttribute('data-site-id')).then(r=>r.json()).then(d=>{const e=document.getElementById('pulse-count');if(e)e.innerText=d.count;const u=document.getElementById('pulse-unique');if(u)u.innerText=d.unique})}catch(e){}})()`);
});

app.listen(PORT, () => console.log(`P.U.L.S.E. System running on port ${PORT}`));
