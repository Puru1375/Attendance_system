// Corrected server.js code

const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const port = 3000;

// --- Database Connection Pool ---
// IMPORTANT: Replace placeholder 'YOUR_CORRECT_PASSWORD' with your actual database password!
// Also ensure 'user' and 'database' name are correct for your setup.
const dbPool = mysql.createPool({
    host: 'localhost',          // Your database host (usually 'localhost')
    user: 'root',             // Your database username (e.g., 'root' or 'attendance_app')
    password: 'Purvanshu13', // !!! REPLACE THIS WITH YOUR REAL PASSWORD !!!
    database: 'iot_project',    // Corrected database name based on previous steps
    waitForConnections: true,
    connectionLimit: 10,        // Max number of connections in pool
    queueLimit: 0               // Max number of connection requests to queue (0 = no limit)
});

// --- Test Database Connection (Optional but Recommended) ---
// Immediately try to get a connection to check if credentials are valid
async function testDbConnection() {
    let connection;
    try {
        connection = await dbPool.getConnection();
        console.log('Successfully connected to the database!'); // Look for this message on startup
    } catch (err) {
        console.error('Error connecting to the database:', err); // This will show if password/user/db is wrong
        // Consider exiting if the DB isn't available on startup
        // process.exit(1);
    } finally {
        if (connection) connection.release(); // Always release the connection!
    }
}
testDbConnection(); // Call the function to test connection on server start


// --- Middleware ---
app.use(express.json()); // To parse JSON request bodies

// --- Routes ---
app.get('/', (req, res) => {
  // Added a note about DB connection test status
  res.status(200).send('Attendance Backend is running! Check console for DB connection status.');
});

// --- API Endpoints ---

/**
 * POST /api/mark_attendance
 * Receives a list of Bluetooth MAC addresses from the ESP32,
 * finds corresponding students, and records their attendance.
 * Expects JSON body: { "mac_addresses": ["XX:XX:...", "YY:YY:...", ...] }
 */
app.post('/api/mark_attendance', async (req, res) => {
    const macAddresses = req.body.mac_addresses;

    // --- Input Validation ---
    if (!macAddresses || !Array.isArray(macAddresses)) {
        return res.status(400).json({ message: 'Invalid request body. Expecting { "mac_addresses": Array }' });
    }
    if (macAddresses.length === 0) {
        return res.status(200).json({ message: 'Received empty list, no attendance marked.' });
    }

    console.log(`[${new Date().toISOString()}] Received Attendance Request: ${macAddresses.join(', ')}`);

    let markedCount = 0;
    let alreadyMarkedCount = 0;
    let notFoundCount = 0;
    const errors = [];
    const processedMacs = new Set(); // To avoid processing duplicates within the same request

    // --- Process Each MAC Address ---
    await Promise.all(macAddresses.map(async (mac) => {
        const normalizedMac = mac.toUpperCase();
        if (processedMacs.has(normalizedMac)) return;
        processedMacs.add(normalizedMac);

        let connection;
        try {
            // Get connection from the pool defined above
            connection = await dbPool.getConnection();

            // 1. Find Student ID by MAC Address
            const findStudentSql = "SELECT student_id FROM students WHERE bluetooth_mac_address = ?";
            const [studentRows] = await connection.execute(findStudentSql, [normalizedMac]);

            if (studentRows.length > 0) {
                const studentId = studentRows[0].student_id;

                // 2. Check if Already Marked Recently
                const recentMinutes = 60;
                const checkRecentSql = `
                    SELECT record_id FROM attendance_records
                    WHERE student_id = ? AND attendance_time >= NOW() - INTERVAL ? MINUTE
                    LIMIT 1
                `;
                const [recentRows] = await connection.execute(checkRecentSql, [studentId, recentMinutes]);

                if (recentRows.length === 0) {
                    // 3. Insert New Attendance Record
                    const insertAttendanceSql = "INSERT INTO attendance_records (student_id, attendance_time) VALUES (?, NOW())";
                    const [insertResult] = await connection.execute(insertAttendanceSql, [studentId]);

                    if (insertResult.affectedRows > 0) {
                        console.log(`Marked attendance for student ${studentId} (MAC: ${normalizedMac})`);
                        markedCount++;
                    } else {
                        errors.push(`Insert failed for ${normalizedMac}`);
                    }
                } else {
                    console.log(`Student ${studentId} (MAC: ${normalizedMac}) already marked present recently.`);
                    alreadyMarkedCount++;
                }
            } else {
                console.log(`MAC address ${normalizedMac} not found in students table.`);
                notFoundCount++;
            }

        } catch (err) {
            // Catch errors during DB operations for this specific MAC
            console.error(`Error processing MAC ${normalizedMac}:`, err);
            errors.push(`Error for ${normalizedMac}: ${err.message}`);
        } finally {
            // Always release the connection back to the pool
            if (connection) connection.release();
        }
    })); // End of Promise.all map

    // --- Send Response ---
    console.log(`Attendance processing complete. Marked: ${markedCount}, Already Marked: ${alreadyMarkedCount}, Not Found: ${notFoundCount}, Errors: ${errors.length}`);
    res.status(200).json({
        message: 'Attendance processing complete.',
        marked: markedCount,
        already_marked: alreadyMarkedCount,
        not_found: notFoundCount,
        errors: errors
    });
});

// GET /api/get_attendance
// Retrieves a list of students marked present recently
app.get('/api/get_attendance', async (req, res) => {
    const recentMinutes = 60;
    console.log(`[${new Date().toISOString()}] Received Request for Recent Attendance (last ${recentMinutes} mins)`);

    let connection;
    try {
        connection = await dbPool.getConnection();

        // Query to get distinct students marked present within the time window
        const getAttendanceSql = `
            SELECT DISTINCT s.name, s.roll_number, MAX(ar.attendance_time) as last_seen
            FROM attendance_records ar
            JOIN students s ON ar.student_id = s.student_id
            WHERE ar.attendance_time >= NOW() - INTERVAL ? MINUTE
            GROUP BY s.student_id, s.name, s.roll_number
            ORDER BY last_seen DESC;
        `;
        const [attendanceRows] = await connection.execute(getAttendanceSql, [recentMinutes]);

        // Send the list of present students back as JSON
        res.status(200).json(attendanceRows);

    } catch (err) {
        console.error('Error fetching attendance data:', err);
        // Send an internal server error response
        res.status(500).json({ message: 'Error fetching attendance data', error: err.message });
    } finally {
        // Always release the connection
        if (connection) connection.release();
    }
});


// --- Start the Server ---
app.listen(port, () => {
  console.log(`Attendance server listening at http://localhost:${port}`);
});