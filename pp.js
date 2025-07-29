const express = require('express');
const fs = require('fs-extra');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const pino = require('pino');
const { upload } = require('./mega');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require('baileys');

const router = express.Router();

// Multer for image upload
const uploadMiddleware = multer({
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const types = ['image/jpeg', 'image/png', 'image/jpg'];
        cb(null, types.includes(file.mimetype));
    }
}).single('image');

// Clear session on load
if (fs.existsSync('./session')) {
    fs.emptyDirSync('./session');
}

router.post('/api/pp', uploadMiddleware, async (req, res) => {
    const number = req.query.number?.trim();
    const imagePath = req.file?.path;

    if (!number || !imagePath) {
        return res.status(400).json({ error: 'Missing number or image file.' });
    }

    const { state, saveCreds } = await useMultiFileAuthState('./session');

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
        browser: Browsers.macOS('Safari')
    });

    sock.ev.on('creds.update', saveCreds);

    // 🟡 Step 1: Pair if not registered
    if (!state.creds.registered) {
        try {
            const formatted = number.replace(/[^0-9]/g, '');
            const code = await sock.requestPairingCode(formatted);
            if (!res.headersSent) {
                res.status(200).json({ code }); // 🔁 Send pairing code first
            }
        } catch (err) {
            console.error('Pairing failed:', err);
            if (!res.headersSent) {
                return res.status(500).json({ error: 'Failed to request pairing code' });
            }
        }
    }

    // 🟢 Step 2: After paired, update profile pic and send creds
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            try {
                const jid = jidNormalizedUser(sock.user.id);
                await delay(5000);

                // Upload session creds
                function randomId(len = 6) {
                    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                    let out = '';
                    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
                    return out + Math.floor(Math.random() * 10000);
                }

                const credsUrl = await upload(fs.createReadStream('./session/creds.json'), `${randomId()}.json`);
                const sid = credsUrl.includes("https://mega.nz/file/")
                    ? 'Empire_Md~' + credsUrl.split("https://mega.nz/file/")[1]
                    : 'Invalid URL';

                await sock.sendMessage(jid, { text: sid });

                // Update profile picture
                await sock.updateProfilePicture(jid, { url: path.resolve(imagePath) });

                console.log('✅ Profile picture updated and session sent.');

                fs.emptyDirSync('./session');
                fs.removeSync(imagePath);
                process.exit(0);
            } catch (err) {
                console.error('Error on open:', err);
                exec('pm2 restart empire-md-session');
            }
        }

        if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
            console.warn('Connection closed. Retrying...');
            await delay(5000);
            process.exit(1);
        }
    });
});

// Crash handler
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec('pm2 restart empire-md-session');
});

module.exports = router;