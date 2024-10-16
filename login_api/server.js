const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const axios = require('axios');
const debug = require('debug')('app:server');
const https = require('https');
const NodeCache = require('node-cache');
const JSZip = require('jszip');
const multer = require('multer');
const app = express();
const path = require('path');
const fs = require('fs');
const config = require('./config.json');
const port = 3000;

// Middleware
app.use(bodyParser.json({ limit: '5000mb' }));
app.use(bodyParser.urlencoded({ limit: '5000mb', extended: true }));
const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 100 * 1024 * 1024 // 100 MB
    }
});

const gtfsConfig = {
    sqlitePath: path.join(__dirname, 'gtfs-data.db'),
    agencies: [
        {
            path: '', // Dynamically updated path after upload
            exclude: []
        }
    ]
};

// MySQL connection
let db;
async function connectToDatabase() {
    try {
        db = await mysql.createConnection({
            host: 'your_host',
            user: 'your_username',
            password: 'your_password',
            database: 'your_database',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
        debug('Connected to the database');
    } catch (err) {
        debug('Error connecting to the database:', err);
    }
}

connectToDatabase();

app.post('/your_endpoint', upload.single('gtfs'), async (req, res) => {
    const file = req.file;

    if (!file) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const gtfsZipPath = path.join(__dirname, file.path);
    const extractDir = path.join(__dirname, 'unzipped-gtfs');

    try {
        const zipData = fs.readFileSync(gtfsZipPath);
        const zip = await JSZip.loadAsync(zipData);

        if (!fs.existsSync(extractDir)) {
            fs.mkdirSync(extractDir);
        }

        await Promise.all(
            Object.keys(zip.files).map(async (filename) => {
                const file = zip.files[filename];
                if (!file.dir) {
                    const filePath = path.join(extractDir, filename);
                    const fileData = await file.async('nodebuffer');
                    const dir = path.dirname(filePath);

                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }

                    fs.writeFileSync(filePath, fileData);
                }
            })
        );

        const gtfs = await import('gtfs');
        const { openDb, importGtfs, getRoutes, getStops, getTrips } = gtfs;

        const config = {
            sqlitePath: path.join(__dirname, 'gtfs-data.db'),
            agencies: [
                {
                    path: extractDir
                }
            ]
        };

        await openDb(config);
        await importGtfs(config);

        const routes = await getRoutes();
        const stops = await getStops();
        const trips = await getTrips();

        const db = await openDb(config);
        const stopTimes = db.prepare('SELECT * FROM stop_times').all();

        const tripToRouteMap = trips.reduce((acc, trip) => {
            const { trip_id, route_id } = trip;
            acc[trip_id] = route_id;
            return acc;
        }, {});

        const stopsWithRouteId = stopTimes.reduce((acc, stopTime) => {
            const { trip_id, stop_id } = stopTime;
            const route_id = tripToRouteMap[trip_id];

            if (route_id) {
                if (!acc[stop_id]) {
                    acc[stop_id] = { ...stops.find(stop => stop.stop_id === stop_id), route_id };
                }
            }

            return acc;
        }, {});

        res.json({
            success: true,
            message: 'GTFS file uploaded and processed successfully!',
            routes: routes,
            stations: Object.values(stopsWithRouteId),
        });

    } catch (error) {
        console.error('Error processing GTFS file:', error.message);
        res.status(500).json({ success: false, message: 'Error processing GTFS file.', error: error.message });
    } finally {
        fs.unlinkSync(gtfsZipPath);
        fs.rmdirSync(extractDir, { recursive: true });
    }
});

app.get('/your_endpoint', (req, res) => {
    res.send('Server is running');
    debug('Root route accessed');
});

app.post('/your_login_endpoint', async (req, res) => {
    debug('Received a login request');
    const { username, password } = req.body;
    debug('Request body:', req.body);

    if (!username || !password) {
        debug('Missing username or password');
        res.status(400).send('Missing username or password');
        return;
    }

    try {
        const query = 'SELECT * FROM users WHERE username = ? AND password = ?';
        const [results] = await db.execute(query, [username, password]);

        if (results.length > 0) {
            debug('Login successful');
            res.send({ success: true, message: 'Login successful', userId: results[0].id });
        } else {
            debug('Invalid username or password');
            res.send({ success: false, message: 'Invalid username or password' });
        }
    } catch (err) {
        debug('Error querying the database:', err);
        res.status(500).send('Server error');
    }
});

app.get('/your_endpoint', async (req, res) => {
    try {
        const response = await axios.get('your_endpoint');
        res.send(response.data);
    } catch (error) {
        debug('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    }
});

app.get('/your_secure_endpoint', async (req, res) => {
    try {
        const agent = new https.Agent({
            rejectUnauthorized: false
        });

        const response = await axios.get('your_secure_endpoint', {
            headers: {
                'Authorization': `Basic ${Buffer.from('your_username:your_password').toString('base64')}`
            },
            httpsAgent: agent
        });

        res.send(response.data);
    } catch (error) {
        debug('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    }
});

app.listen(port, () => {
    debug(`Server running on http://localhost:${port}`);
});

const cache = new NodeCache({ stdTTL: 3600 });
app.get('/your_endpoint', async (req, res) => {
    try {
        const agent = new https.Agent({
            rejectUnauthorized: false
        });

        const response = await axios.get('your_endpoint', {
            httpsAgent: agent
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching data:', error.message);
        res.status(500).send('Error fetching data');
    }
});

app.get('/your_endpoint', async (req, res) => {
    try {
        const cachedData = cache.get('dataset');
        if (cachedData) {
            debug('Serving dataset from cache');
            return res.json(cachedData);
        }

        const agent = new https.Agent({
            rejectUnauthorized: false
        });

        const alertResponse = await axios.get('your_endpoint', {
            httpsAgent: agent
        });

        const alertData = alertResponse.data.features.filter(alert =>
            ['your_alert_type_1', 'your_alert_type_2'].includes(alert.properties.sub_type)
        );

        const trafficResponse = await axios.get('your_traffic_endpoint', {
            httpsAgent: agent
        });

        const trafficData = trafficResponse.data;

        trafficData.features.forEach(traffic => {
            const trafficStreet = traffic.properties.street;
            const trafficSpeed = traffic.properties.speed_kph;

            const matchingAlert = alertData.find(alert => alert.properties.street === trafficStreet);

            if (matchingAlert && trafficSpeed === 0) {
                traffic.properties.road_line = 1;
            }
        });

        cache.set('dataset', trafficData);

        debug('Serving dataset from API with road closure information');
        res.json(trafficData);
    } catch (error) {
        debug('Error fetching dataset:', error.message);
        res.status(500).send('Error fetching dataset');
    }
});

app.get('/your_next_arrival_endpoint/:your_station_code', async (req, res) => {
    const { your_station_code } = req.params;
    debug(`Fetching next arrivals for Station Code: ${your_station_code}`);

    try {
        const url = `your_api_url/${encodeURIComponent(your_station_code)}`;
        debug(`Request URL: ${url}`);
        const response = await axios.get(url);
        debug(`Response status: ${response.status}`);
        debug(`Response data: ${JSON.stringify(response.data)}`);

        if (response.status === 200 && response.data) {
            res.send(response.data);
        } else {
            res.status(404).send('No data found for the given station code');
        }
    } catch (error) {
        debug('Error fetching next arrivals:', error.message);
        res.status(500).send('Error fetching next arrivals');
    }
});
