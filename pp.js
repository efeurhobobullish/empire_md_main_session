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

// Multer setup for image uploads
const uploadMiddleware = multer({
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
        cb(null, allowedTypes.includes(file.mimetype));
    }
}).single('image');

// Clear session folder on startup
if (fs.existsSync('./session')) {
    fs.emptyDirSync('./session');
}

router.post('/api/pp', uploadMiddleware, async (req, res) => {
    const num = req.query.number;
    const imagePath = req.file?.path;

    if (!num || !imagePath) {
        return res.status(400).json({ error: 'Missing number or image file.' });
    }

    async function EmpirePP() {
        const { state, saveCreds } = await useMultiFileAuthState('./session');
        try {
            const EmpirePPWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
                browser: Browsers.macOS('Safari'),
            });

            if (!EmpirePPWeb.authState.creds.registered) {
                await delay(1500);
                const formattedNum = num.replace(/[^0-9]/g, '');
                const code = await EmpirePPWeb.requestPairingCode(formattedNum);
                if (!res.headersSent) res.send({ code });
            }

            EmpirePPWeb.ev.on('creds.update', saveCreds);

            EmpirePPWeb.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    try {
                        await delay(10000);
                        const authPath = './session/';
                        const userJid = jidNormalizedUser(EmpirePPWeb.user.id);

                        function randomMegaId(length = 6, numberLength = 4) {
                            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                            let id = '';
                            for (let i = 0; i < length; i++) {
                                id += chars.charAt(Math.floor(Math.random() * chars.length));
                            }
                            const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                            return `${id}${number}`;
                        }

                        const megaUrl = await upload(fs.createReadStream(authPath + 'creds.json'), `${randomMegaId()}.json`);
                        const sid = megaUrl.includes('https://mega.nz/file/')
                            ? 'Empire_Md~' + megaUrl.split('https://mega.nz/file/')[1]
                            : 'Error: Invalid URL';

                        await EmpirePPWeb.sendMessage(userJid, { text: sid });

                        await EmpirePPWeb.updateProfilePicture(userJid, {
                            url: path.resolve(imagePath)
                        });

                    } catch (err) {
                        console.error('Error updating profile picture:', err);
                        exec('pm2 restart empire-md-session');
                    } finally {
                        fs.emptyDirSync('./session');
                        fs.removeSync(imagePath);
                        process.exit(0);
                    }
                } else if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
                    await delay(10000);
                    EmpirePP();
                }
            });

        } catch (err) {
            console.error('Fatal error:', err);
            exec('pm2 restart empire-md-session');
            fs.emptyDirSync('./session');
            fs.removeSync(imagePath);
            if (!res.headersSent) {
                res.status(503).send({ error: 'Service Unavailable' });
            }
        }
    }

    EmpirePP();
});

process.on('uncaughtException', (err) => {
    console.log('Uncaught exception:', err);
    exec('pm2 restart empire-md-session');
});

module.exports = router;