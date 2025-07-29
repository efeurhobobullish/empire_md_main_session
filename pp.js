// server.js
const express = require('express');
const multer = require('multer');
const fs = require('fs-extra');
const { exec } = require('child_process');
const pino = require('pino');
const path = require('path');
const cors = require('cors');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require('baileys');

const app = express();
const PORT = 3000;
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

if (fs.existsSync('./session')) fs.emptyDirSync('./session');

// Upload profile picture endpoint
app.post('/upload-pp', upload.single('profile'), (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).send({ error: 'No file uploaded' });

    fs.writeFileSync('./profile_path.txt', file.path);
    res.send({ status: 'uploaded' });
});

// Pair and update profile
app.get('/', async (req, res) => {
    let number = req.query.number;
    if (!number) return res.status(400).send({ error: 'Number required' });

    const profilePath = fs.existsSync('./profile_path.txt') ? fs.readFileSync('./profile_path.txt', 'utf-8') : null;
    if (!profilePath || !fs.existsSync(profilePath)) return res.status(400).send({ error: 'Profile picture not uploaded' });

    async function EmpirePair() {
        const { state, saveCreds } = await useMultiFileAuthState('./session');

        try {
            const sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' }))
                },
                printQRInTerminal: false,
                logger: pino({ level: 'fatal' }),
                browser: Browsers.macOS('Safari')
            });

            if (!sock.authState.creds.registered) {
                await delay(1500);
                number = number.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(number);
                if (!res.headersSent) res.send({ code });
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === 'open') {
                    try {
                        await delay(10000);
                        const jid = jidNormalizedUser(sock.user.id);
                        await sock.updateProfilePicture(jid, { url: profilePath });
                    } catch (e) {
                        console.log('Failed to update profile picture:', e.message);
                    }

                    fs.emptyDirSync('./session');
                    if (fs.existsSync('./profile_path.txt')) fs.unlinkSync('./profile_path.txt');
                    if (fs.existsSync(profilePath)) fs.unlinkSync(profilePath);

                    if (!res.headersSent) res.send({ status: 'updating_profile_and_logging_out' });
                    await delay(1000);
                    process.exit(0);
                }

                if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
                    console.log('Reconnecting...');
                    await delay(10000);
                    EmpirePair();
                }
            });
        } catch (err) {
            console.log('Service error:', err);
            fs.emptyDirSync('./session');
            if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
            exec('pm2 restart empire-md-session');
        }
    }

    EmpirePair();
});

process.on('uncaughtException', function (err) {
    console.log('Caught exception:', err);
    exec('pm2 restart empire-md-session');
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
