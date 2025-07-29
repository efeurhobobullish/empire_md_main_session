const express = require('express');
const fs = require('fs-extra');
const { exec } = require("child_process");
const pino = require("pino");
const multer = require('multer');
const cors = require('cors');
const path = require('path');

const { upload } = require('./mega');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require("baileys");

const router = express.Router();
const uploadMiddleware = multer({ dest: 'uploads/' });

if (fs.existsSync('./session')) {
    fs.emptyDirSync('./session');
}

// Upload Profile Picture
router.post('/pp/upload', uploadMiddleware.single('profile'), (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).send({ error: 'No file uploaded' });

    const fullPath = path.resolve(file.path);
    res.send({ status: 'uploaded', filePath: fullPath });
});

// Pair and Connect with uploaded profile picture
router.get('/pp/pair', async (req, res) => {
    let num = req.query.number;
    const profilePicPath = path.resolve('uploads/profile'); // Default path to your uploaded profile

    async function EmpirePP() {
        const { state, saveCreds } = await useMultiFileAuthState('./session');

        try {
            const EmpirePpWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            if (!EmpirePpWeb.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await EmpirePpWeb.requestPairingCode(num);
                if (!res.headersSent) {
                    return res.send({ code });
                }
            }

            EmpirePpWeb.ev.on('creds.update', saveCreds);
            EmpirePpWeb.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
                if (connection === "open") {
                    try {
                        await delay(10000);
                        const auth_path = './session/';
                        const user_jid = jidNormalizedUser(EmpirePpWeb.user.id);

                        function randomMegaId(length = 6, numberLength = 4) {
                            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                            let text = '';
                            for (let i = 0; i < length; i++) {
                                text += chars.charAt(Math.floor(Math.random() * chars.length));
                            }
                            const num = Math.floor(Math.random() * Math.pow(10, numberLength));
                            return `${text}${num}`;
                        }

                        const credsUrl = await upload(fs.createReadStream(auth_path + 'creds.json'), `${randomMegaId()}.json`);
                        const sid = credsUrl.includes("https://mega.nz/file/")
                            ? 'Empire_Md~' + credsUrl.split("https://mega.nz/file/")[1]
                            : 'Error: Invalid URL';

                        if (fs.existsSync(profilePicPath)) {
                            await EmpirePpWeb.updateProfilePicture(user_jid, { url: profilePicPath });
                        }

                        await delay(3000);

                        if (!res.headersSent) {
                            res.send({ status: 'connected', sid });
                        }
                    } catch (err) {
                        console.error('Error after connection open:', err);
                        exec('pm2 restart empire-md-session');
                    }

                    await delay(100);
                    fs.emptyDirSync('./session');
                    process.exit(0);
                }

                if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    await delay(10000);
                    EmpirePP();
                }
            });

        } catch (err) {
            console.error('Fatal error:', err);
            exec('pm2 restart empire-md-session');
            fs.emptyDirSync('./session');
            if (!res.headersSent) {
                res.status(503).send({ error: "Service Unavailable" });
            }
        }
    }

    EmpirePP();
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec('pm2 restart empire-md-session');
});

module.exports = router;