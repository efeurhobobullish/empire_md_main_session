const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Increase EventEmitter listener limit
require('events').EventEmitter.defaultMaxListeners = 1000;

// MongoDB Connection
mongoose.connect(
  process.env.MONGODB_URI || 'mongodb+srv://empiretech:FcK8BIY1TgpwozDW@hostempiretech.jtecovm.mongodb.net/?retryWrites=true&w=majority&appName=hostempiretech',
  { useNewUrlParser: true, useUnifiedTopology: true }
)
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Click Schema and Model
const clickSchema = new mongoose.Schema({
  ip: String,
  route: String,
  value: Number,
  createdAt: { type: Date, default: Date.now },
});

const Click = mongoose.model('Click', clickSchema);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Utility to Get Client IP
const getIP = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress;
};

// === Click Logging Pages ===
const logClickAndServe = (routePath, fileName) => {
  app.get(routePath, async (req, res) => {
    try {
      const ip = getIP(req);
      await Click.create({ ip, route: routePath, value: 1 });
      console.log(`✅ ${routePath} click recorded from IP: ${ip}`);
    } catch (err) {
      console.error(`❌ Error saving ${routePath} click:`, err);
    }
    res.sendFile(path.join(__dirname, fileName));
  });
};

logClickAndServe('/pair', 'pair.html');          // logs click
logClickAndServe('/qr-page', 'qr.html');         // logs click

// Static (no logging)
app.get('/donate', (req, res) => {
  res.sendFile(path.join(__dirname, 'donate.html'));
});


app.get('/profile-picture', (req, res) => {
  res.sendFile(path.join(__dirname, 'profile-picture.html'));
});

app.get('/session', (req, res) => {
  res.sendFile(path.join(__dirname, 'session.html'));
});

app.get('/thank-you', (req, res) => {
  res.sendFile(path.join(__dirname, 'thank-you.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'));
});

// Click Summary (last 24h)
app.get('/clicks', async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, pair, qrPage, lastPair, lastQrPage] = await Promise.all([
      Click.countDocuments({ createdAt: { $gte: since } }),
      Click.countDocuments({ route: '/pair', createdAt: { $gte: since } }),
      Click.countDocuments({ route: '/qr-page', createdAt: { $gte: since } }),
      Click.findOne({ route: '/pair' }).sort({ createdAt: -1 }),
      Click.findOne({ route: '/qr-page' }).sort({ createdAt: -1 }),
    ]);

    res.json({
      totalClicks: total,
      pairClicks: pair,
      qrPageClicks: qrPage,
      lastPairTime: lastPair?.createdAt || null,
      lastQrPageTime: lastQrPage?.createdAt || null,
    });
  } catch (err) {
    console.error('❌ Error fetching click stats:', err);
    res.status(500).json({ message: 'Failed to fetch click stats' });
  }
});

// Analytics Endpoint
app.get('/api/analytics', async (req, res) => {
  try {
    const range = req.query.range || '24h';
    const now = Date.now();
    let startDate;

    switch (range) {
      case '7d':
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now - 24 * 60 * 60 * 1000);
    }

    const format = range === '24h' ? "%Y-%m-%dT%H:00:00" : "%Y-%m-%d";

    const data = await Click.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $project: {
          route: 1,
          date: { $dateToString: { format, date: "$createdAt" } },
        }
      },
      {
        $group: {
          _id: "$date",
          time: { $first: "$date" },
          qrPageCount: {
            $sum: {
              $cond: [{ $eq: ["$route", "/qr-page"] }, 1, 0]
            }
          },
          pairCount: {
            $sum: {
              $cond: [{ $eq: ["$route", "/pair"] }, 1, 0]
            }
          },
        }
      },
      { $sort: { time: 1 } }
    ]);

    res.json(data);
  } catch (err) {
    console.error('❌ Error fetching analytics:', err);
    res.status(500).json({ message: 'Failed to fetch analytics' });
  }
});

// Uptime endpoint
app.get('/api/uptime', (req, res) => {
  try {
    const uptime = Math.floor(process.uptime());
    res.json({ uptime });
  } catch (err) {
    console.error('Error getting uptime:', err);
    res.status(500).json({ error: 'Failed to get uptime' });
  }
});

// Get Local IP Address
app.get('/api/local-ip', (req, res) => {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return res.json({ ip: iface.address });
      }
    }
  }
  res.json({ ip: '127.0.0.1' });
});

// External Routes
const qrRouter = require('./qr');
const pairRouter = require('./pair');

app.use('/qr', qrRouter);      // used for QR display logic (no logging)
app.use('/code', pairRouter);

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

module.exports = app;
