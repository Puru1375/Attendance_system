function fetchAttendanceData() {
    fetch('/api/get_attendance')
        .then(response => response.json())
        .then(data => {
            const attendanceListDiv = document.getElementById('attendance-list');
            attendanceListDiv.innerHTML = ''; // Clear previous data

            if (data.length === 0) {
                attendanceListDiv.textContent = 'No attendance records found recently.';
                return;
            }

            const ul = document.createElement('ul');
            data.forEach(record => {
                const li = document.createElement('li');
                const lastSeen = new Date(record.last_seen);
                li.textContent = `${record.name} (${record.roll_number}) - Last seen: ${lastSeen.toLocaleTimeString()}`;
                ul.appendChild(li);
            });
            attendanceListDiv.appendChild(ul);
        })
        .catch(error => {
            console.error('Error fetching attendance:', error);
            const attendanceListDiv = document.getElementById('attendance-list');
            attendanceListDiv.textContent = 'Failed to load attendance data.';
        });
}

// Fetch attendance data when the page loads
fetchAttendanceData();

// Refresh attendance data every 30 seconds (adjust as needed)
setInterval(fetchAttendanceData, 30000);