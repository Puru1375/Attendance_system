// backend/server.js

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = 3000;

// --- Database Connection ---
const DBSOURCE = path.join(__dirname, "attendance_system.sqlite"); // Renamed for clarity

const db = new sqlite3.Database(DBSOURCE, (err) => {
    if (err) {
        console.error("FATAL ERROR opening database:", err.message);
        throw err;
    } else {
        console.log('Connected to the SQLite database: attendance_system.sqlite');
        initializeDb();
    }
});

function initializeDb() {
    console.log("Attempting to initialize database tables...");

    // Using db.serialize to ensure sequential execution
    db.serialize(() => {
        // 1. Students Table
        db.run(`CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            bluetooth_address TEXT UNIQUE NOT NULL
        )`, (err) => {
            if (err) {
                console.error(" SQLite Error creating 'students' table:", err.message);
            } else {
                console.log("'students' table checked/created successfully.");
            }
        });

        // 2. Attendance Log Table
        // This will run after the students table command has been issued.
        db.run(`CREATE TABLE IF NOT EXISTS attendance_log (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_pk INTEGER NOT NULL,
            device_address_scanned TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
            status TEXT DEFAULT 'Present' NOT NULL,
            FOREIGN KEY (student_pk) REFERENCES students(id) ON DELETE CASCADE
        )`, (err) => {
            if (err) {
                console.error(" SQLite Error creating 'attendance_log' table:", err.message);
                // Common error here: "Error: SQLITE_ERROR: foreign key mismatch - "attendance_log" referencing "students""
                // This can happen if the 'students' table (or its 'id' column) doesn't exist as expected.
            } else {
                console.log("'attendance_log' table checked/created successfully.");
            }
        });

        // Optional: Verify tables exist after creation attempts
        db.all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('students', 'attendance_log');", (err, tables) => {
            if (err) {
                console.error("Error verifying tables:", err.message);
            } else {
                console.log("Tables found in sqlite_master:", tables.map(t => t.name).join(', '));
                if (tables.length < 2) {
                    console.warn("WARNING: Not all expected tables were found after initialization!");
                }
            }
            console.log("Database initialization sequence complete.");
        });
    });
}
// function handleError(err) { if (err) console.error("DB Insert Error:", err.message); }


// --- Promisified Database Helper Functions ---
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                console.error('DB Run Error:', err.message, '| SQL:', sql, '| Params:', params);
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                console.error('DB Get Error:', err.message, '| SQL:', sql, '| Params:', params);
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                console.error('DB All Error:', err.message, '| SQL:', sql, '| Params:', params);
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// --- Routes ---
app.get('/', (req, res) => {
  res.status(200).send('Attendance Backend is running with SQLite! Check console for DB status.');
});

// --- API Endpoints ---

/**
 * POST /api/mark_attendance
 * Receives: { "mac_addresses": ["XX:XX:...", "YY:YY:...", ...] }
 */
app.post('/api/mark_attendance', async (req, res) => {
    const macAddresses = req.body.mac_addresses;

    if (!macAddresses || !Array.isArray(macAddresses)) {
        return res.status(400).json({ message: 'Invalid request: "mac_addresses" array is required.' });
    }
    if (macAddresses.length === 0) {
        return res.status(200).json({ message: 'Received empty list, no attendance marked.' });
    }

    console.log(`[${new Date().toISOString()}] Attendance Request for MACs: ${macAddresses.join(', ')}`);

    let markedCount = 0;
    let alreadyMarkedRecentlyCount = 0;
    let notFoundCount = 0;
    const errors = [];
    const processedMacs = new Set(); // Avoid processing duplicates in the same request

    for (const mac of macAddresses) {
        const normalizedMac = mac.toUpperCase().trim(); // Normalize
        if (processedMacs.has(normalizedMac) || !normalizedMac) continue;
        processedMacs.add(normalizedMac);

        try {
            // 1. Find Student by their registered Bluetooth MAC Address
            const findStudentSql = "SELECT id, student_id, name FROM students WHERE bluetooth_address = ?";
            const student = await dbGet(findStudentSql, [normalizedMac]);

            if (student) {
                const studentPk = student.id; // This is students.id

                // 2. Check if this student (identified by student_pk) was already marked recently
                const recentMinutes = 30; // Define "recently"
                const checkRecentSql = `
                    SELECT log_id FROM attendance_log
                    WHERE student_pk = ? AND timestamp >= datetime('now', '-' || ? || ' minutes') 
                    LIMIT 1
                `;
                const recentLog = await dbGet(checkRecentSql, [studentPk, recentMinutes]);

                if (!recentLog) {
                    // 3. Insert New Attendance Record
                    const insertLogSql = `
                        INSERT INTO attendance_log (student_pk, device_address_scanned) 
                        VALUES (?, ?)
                    `;
                    const insertResult = await dbRun(insertLogSql, [studentPk, normalizedMac]);

                    if (insertResult.changes > 0) {
                        console.log(`Marked attendance for ${student.name} (ID: ${student.student_id}, MAC: ${normalizedMac}), Log ID: ${insertResult.lastID}`);
                        markedCount++;
                    } else {
                        errors.push(`Insert failed for ${normalizedMac} (Student: ${student.name}) - no rows affected.`);
                    }
                } else {
                    console.log(`${student.name} (MAC: ${normalizedMac}) already marked present recently (Log ID: ${recentLog.log_id}).`);
                    alreadyMarkedRecentlyCount++;
                }
            } else {
                console.log(`MAC address ${normalizedMac} not registered to any student.`);
                notFoundCount++;
            }

        } catch (err) {
            console.error(`Error processing MAC ${normalizedMac}:`, err.message);
            errors.push(`Error for ${normalizedMac}: ${err.message}`);
        }
    }

    console.log(`Attendance processing complete. Marked: ${markedCount}, Already Marked: ${alreadyMarkedRecentlyCount}, Not Found: ${notFoundCount}, Errors: ${errors.length}`);
    res.status(200).json({
        message: 'Attendance processing complete.',
        marked: markedCount,
        already_marked_recently: alreadyMarkedRecentlyCount,
        not_found: notFoundCount,
        errors: errors
    });
});

/**
 * GET /api/get_attendance
 * Retrieves a list of students marked present recently.
 */
app.get('/api/get_attendance', async (req, res) => {
    const recentMinutes = 60;
    console.log(`[${new Date().toISOString()}] Request for Recent Attendance (last ${recentMinutes} mins)`);

    try {
        const getAttendanceSql = `
            SELECT 
            s.student_id, 
            s.name, 
            s.bluetooth_address AS registered_mac,
            al.device_address_scanned,
            al.timestamp AS utc_timestamp, -- Original UTC timestamp
            al.status
        FROM attendance_log al
        JOIN students s ON al.student_pk = s.id
        WHERE al.timestamp >= datetime('now', '-' || ? || ' minutes', '-5 hours', '-30 minutes') -- Adjust 'now' comparison too
        GROUP BY s.id, s.student_id, s.name, s.bluetooth_address, al.device_address_scanned, al.status 
        ORDER BY utc_timestamp DESC;
        `;
        // Grouping ensures we get one latest entry per student (or per device if a student uses multiple) within the window.

        const attendanceRows = await dbAll(getAttendanceSql, [recentMinutes]);
        const localizedAttendanceRows = attendanceRows.map(row => {
    const utcDate = new Date(row.utc_timestamp + " UTC"); // Ensure JS Date object interprets it as UTC

    // Option A: Using Intl.DateTimeFormat (Modern and flexible)
    const istDateTime = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata', // IANA time zone name for IST
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true // or false for 24-hour format
    }).format(utcDate);

    // Option B: Manual calculation (less robust due to Daylight Saving Time, but IST doesn't have DST)
    // const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
    // const istDate = new Date(utcDate.getTime() + istOffset);
    // const istDateTime = istDate.toISOString().replace('T', ' ').substring(0, 19); // Example format

    return {
        ...row,
        last_seen_ist: istDateTime, // Add a new field for IST
        last_seen_utc: row.utc_timestamp // Keep original UTC too if needed
    };
});
        res.status(200).json(localizedAttendanceRows);

    } catch (err) {
        console.error('Error fetching attendance data:', err.message);
        res.status(500).json({ message: 'Error fetching attendance data', error: err.message });
    }
});

// --- Start the Server ---
app.listen(port, () => {
  console.log(`Attendance server listening at http://localhost:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('SIGINT received. Closing database connection.');
    db.close((err) => {
        if (err) {
            console.error("Error closing database:",err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(err ? 1 : 0);
    });
});