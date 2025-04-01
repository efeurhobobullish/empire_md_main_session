const express = require('express');
const app = express();
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;

// Define the base directory
__path = process.cwd();

// Import required modules
let server = require('./qr'); // Assumed to generate and return a QR image
let code = require('./pair');

require('events').EventEmitter.defaultMaxListeners = 1000;

// Middleware for parsing requests
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static HTML pages
app.get('/qr-page', (req, res) => {
    res.sendFile(__path + '/qr.html');
});

app.get('/pair', (req, res) => {
    res.sendFile(__path + '/pair.html');
});

app.get('/', (req, res) => {
    res.sendFile(__path + '/main.html');
});

// Serve the QR image
app.use('/qr', server);

// Serve additional routes
app.use('/code', code);

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
