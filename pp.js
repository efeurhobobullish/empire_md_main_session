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
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// A simple in-memory object to hold data for the pairing session
let pairingData = {};

if (fs.existsSync('./session')) fs.emptyDirSync('./session');

// 1. Endpoint for profile picture upload, using your defined name '/upload-pp'
app.post('/upload-pp', upload.single('profile'), (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).send({ error: 'No file uploaded' });
    }
    // Return the path of the uploaded file to the frontend
    res.send({ status: 'uploaded', filePath: file.path });
});

// 2. Endpoint to request pairing code, using your defined name '/'
app.get('/', async (req, res) => {
    // Data is now received from query parameters for a GET request
    let { number, filePath } = req.query;

    if (!number) {
        return res.status(400).send({ error: 'Number is required' });
    }
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(400).send({ error: 'Profile picture path is invalid or file does not exist' });
    }

    // Store the file path to be used after connection
    pairingData.profilePath = filePath;

    async function EmpirePair() {
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

        // Request pairing code if not already connected
        if (!sock.authState.creds.registered) {
            await delay(1500);
            // Sanitize the number
            number = number.replace(/[^0-9]/g, '');
            const coode = await sock.requestPairingCode(number);
            // Send the code back to the frontend
            if (!res.headersSent) {
                res.send({ coode });
            }
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect } = s;

            if (connection === 'open') {
                console.log('✅ Connection opened! Updating profile picture...');
                try {
                    await delay(5000); // Small delay to ensure connection is stable
                    const jid = jidNormalizedUser(sock.user.id);
                    const profilePath = pairingData.profilePath;

                    if (profilePath && fs.existsSync(profilePath)) {
                       await sock.updateProfilePicture(jid, { url: profilePath });
                       console.log('📸 Profile picture updated successfully.');
                       // Clean up the uploaded file
                       fs.unlinkSync(profilePath);
                    }
                } catch (e) {
                    console.error('❌ Failed to update profile picture:', e);
                } finally {
                    // Clean up session and exit
                    console.log('Logging out and cleaning up...');
                    fs.emptyDirSync('./session');
                    delete pairingData.profilePath;
                    await delay(1000);
                    process.exit(0);
                }
            }

            if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
                console.log('Connection closed, reconnecting...');
                EmpirePair();
            }
        });
    }

    EmpirePair().catch(err => {
      console.error('Service error:', err);
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
    console.error('Caught exception:', err);
    exec('pm2 restart all');
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
