const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// Parse CLI arguments
const args = process.argv.slice(2);
let sourceDir = null;
let targetDir = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source') {
        sourceDir = args[i + 1];
        i++;
    } else if (args[i] === '--target') {
        targetDir = args[i + 1];
        i++;
    }
}

if (!sourceDir || !targetDir) {
    console.error('Usage: node server.js --source <path> --target <path>');
    process.exit(1);
}

// Resolve absolute paths
sourceDir = path.resolve(sourceDir);
targetDir = path.resolve(targetDir);

console.log(`Starting server...`);
console.log(`Source: ${sourceDir}`);
console.log(`Target: ${targetDir}`);

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.dcm': 'application/dicom',
    '.pdf': 'application/pdf',
};

// Compute SHA-256 hash for file (with text normalization)
function computeFileHashSync(filePath, isText) {
    try {
        let data = fs.readFileSync(filePath);

        if (isText) {
            // Normalize line endings for consistent comparison
            const text = data.toString('utf-8');
            const normalized = text.replace(/\r\n/g, '\n');
            data = Buffer.from(normalized);
        }

        return crypto.createHash('sha256').update(data).digest('hex');
    } catch (e) {
        console.error(`Hash computation failed for ${filePath}:`, e.message);
        return null;
    }
}

// Helper: Scan directory recursively (simplified for flat list as app expected flat mostly, or we adapt)
// The app expects a flat list of files in the folder object.
function scanDirectory(dirPath) {
    const files = [];
    try {
        const items = fs.readdirSync(dirPath);
        items.forEach(item => {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);

            if (stat.isFile()) {
                const ext = path.extname(item).toLowerCase();
                let type = 'default';
                if (['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.py'].includes(ext)) type = 'text';
                else if (['.xlsx', '.xls', '.csv'].includes(ext)) type = 'spreadsheet';
                else if (['.pdf'].includes(ext)) type = 'pdf';
                else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) type = 'image';
                else if (['.dcm', '.dicom'].includes(ext)) type = 'dicom';

                files.push({
                    name: item,
                    size: stat.size / (1024 * 1024), // MB
                    date: stat.mtime.toISOString().split('T')[0],
                    type: type,
                    relativePath: item
                });
            }
        });
    } catch (err) {
        console.error(`Error scanning directory ${dirPath}:`, err);
    }
    return files;
}

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // API endpoint
    if (pathname === '/api/comparison') {
        const sFiles = scanDirectory(sourceDir);
        const tFiles = scanDirectory(targetDir);

        const data = {
            source: {
                name: path.basename(sourceDir),
                path: sourceDir,
                files: sFiles,
                totalSize: sFiles.reduce((acc, f) => acc + f.size, 0)
            },
            target: {
                name: path.basename(targetDir),
                path: targetDir,
                files: tFiles,
                totalSize: tFiles.reduce((acc, f) => acc + f.size, 0)
            }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
    }

    // File streaming endpoints
    if (pathname.startsWith('/files/source/')) {
        const requestedPath = decodeURIComponent(pathname.replace('/files/source/', ''));

        // Enhanced security: prevent directory traversal
        if (requestedPath.includes('..') || requestedPath.startsWith('/')) {
            res.writeHead(403);
            res.end('Forbidden: Invalid path');
            return;
        }

        const filePath = path.join(sourceDir, requestedPath);
        const resolvedPath = path.resolve(filePath);

        // Ensure resolved path is within sourceDir
        if (!resolvedPath.startsWith(path.resolve(sourceDir))) {
            res.writeHead(403);
            res.end('Forbidden: Path outside source directory');
            return;
        }
        serveFile(res, resolvedPath);
        return;
    }

    if (pathname.startsWith('/files/target/')) {
        const requestedPath = decodeURIComponent(pathname.replace('/files/target/', ''));

        // Enhanced security: prevent directory traversal
        if (requestedPath.includes('..') || requestedPath.startsWith('/')) {
            res.writeHead(403);
            res.end('Forbidden: Invalid path');
            return;
        }

        const filePath = path.join(targetDir, requestedPath);
        const resolvedPath = path.resolve(filePath);

        // Ensure resolved path is within targetDir
        if (!resolvedPath.startsWith(path.resolve(targetDir))) {
            res.writeHead(403);
            res.end('Forbidden: Path outside target directory');
            return;
        }
        serveFile(res, resolvedPath);
        return;
    }

    // Static files (app itself)
    let localPath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    serveFile(res, localPath);
});

function serveFile(res, filePath) {
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stats.size
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
}

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
