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
const PORT = process.env.PORT || 3000;
const uplload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

let pairingData = {};

if (fs.existsSync('./session')) fs.emptyDirSync('./session');

app.post('/upload-pp', uplload.single('profile'), (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).send({ error: 'No file uploaded' });
    res.send({ status: 'uploaded', filePath: file.path });
});

app.get('/api/pair', async (req, res) => {
    let { number, filePath } = req.query;

    if (!number) return res.status(400).send({ error: 'Number is required' });
    if (!filePath || !fs.existsSync(filePath)) return res.status(400).send({ error: 'Profile picture not found' });

    pairingData.profilePath = filePath;

    async function startPairing() {
        const { state, saveCreds } = await useMultiFileAuthState('./session');
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
            const coode = await sock.requestPairingCode(number);
            if (!res.headersSent) res.send({ coode });
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect } = s;

            if (connection === 'open') {
                try {
                    await delay(5000);
                    const jid = jidNormalizedUser(sock.user.id);
                    const profilePath = pairingData.profilePath;

                    if (profilePath && fs.existsSync(profilePath)) {
                        await sock.updateProfilePicture(jid, { url: profilePath });
                        fs.unlinkSync(profilePath);
                    }
                } catch (e) {
                    console.error('Profile picture update failed:', e);
                } finally {
                    fs.emptyDirSync('./session');
                    delete pairingData.profilePath;
                    await delay(1000);
                    process.exit(0);
                }
            }

            if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
                startPairing();
            }
        });
    }

    startPairing().catch(err => {
        console.error('Pairing error:', err);
        fs.emptyDirSync('./session');
        if (pairingData.profilePath && fs.existsSync(pairingData.profilePath)) {
            fs.unlinkSync(pairingData.profilePath);
        }
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
        exec('pm2 restart all');
    });
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    exec('pm2 restart all');
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));