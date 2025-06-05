// public/script.js

function fetchAttendanceData() {
    fetch('/api/get_attendance')
        .then(response => {
            if (!response.ok) {
                return response.json().then(errData => {
                    throw new Error(errData.message || `Server error: ${response.status}`);
                }).catch(() => {
                    throw new Error(`Server error: ${response.status}`);
                });
            }
            return response.json();
        })
        .then(data => {
            const attendanceListDiv = document.getElementById('attendance-list');
            if (!attendanceListDiv) {
                console.error("Element with ID 'attendance-list' not found.");
                return;
            }
            attendanceListDiv.innerHTML = ''; 

            if (!Array.isArray(data) || data.length === 0) {
                attendanceListDiv.textContent = 'No recent attendance records found.';
                return;
            }

            const ul = document.createElement('ul');
            data.forEach(record => {
                const li = document.createElement('li');
                const utcDateString = record.last_seen_utc; // Assuming server sends 'last_seen_utc'
                const dateObj = new Date(utcDateString + " UTC"); // Tell JS it's a UTC string

                // Option A: Display in user's browser local time
                // const localTimeString = dateObj.toLocaleTimeString(); 

                // Option B: Dis   play in IST using Intl.DateTimeFormat
                const istTimeString = new Intl.DateTimeFormat('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                }).format(dateObj);         
                
                // Data from backend: student_id, name, registered_mac, device_address_scanned, last_seen, status
                li.textContent = 
                    `${record.name} (ID: ${record.student_id}) ` +
                    `- Last seen: ${lastSeen.toLocaleTimeString()} ` +
                    `(${record.status}, Scanned MAC: ${record.device_address_scanned})`;
                ul.appendChild(li);
            });
            attendanceListDiv.appendChild(ul);
        })
        .catch(error => {
            console.error('Error fetching attendance:', error);
            const attendanceListDiv = document.getElementById('attendance-list');
            if (attendanceListDiv) {
                attendanceListDiv.textContent = `Failed to load attendance data. ${error.message}`;
            }
        });
}

document.addEventListener('DOMContentLoaded', () => {
    fetchAttendanceData();
    setInterval(fetchAttendanceData, 30000); 
});