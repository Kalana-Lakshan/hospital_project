const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const app = express();
const port = 3000;

// ✅ Middleware to parse form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ✅ Serve static files (HTML, CSS, JS) from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// ✅ MySQL connection setup
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'hospital'
});

connection.connect((err) => {
  if (err) {
    console.error('MySQL connection error:', err);
    return;
  }
  console.log('✅ Connected to MySQL database');
});

// ✅ Route: Get doctor list
app.get('/doctors', (req, res) => {
  connection.query('SELECT name FROM doctors', (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(results);
  });
});

// ✅ Route: Get available slots for selected doctor and date
app.get('/available-slots', (req, res) => {
  const { doctor, date } = req.query;

  const getDoctorIdSQL = 'SELECT id FROM doctors WHERE name = ?';
  connection.query(getDoctorIdSQL, [doctor], (err, docRes) => {
    if (err || docRes.length === 0) return res.status(400).json([]);

    const doctorId = docRes[0].id;
    const slotQuery = `
      SELECT slot_time FROM time_slots 
      WHERE doctor_id = ? AND slot_date = ? AND is_booked = FALSE
    `;
    connection.query(slotQuery, [doctorId, date], (err2, slots) => {
      if (err2) return res.status(500).json([]);
      res.json(slots);
    });
  });
});

// ✅ Route: Handle appointment booking
app.post('/channeling', (req, res) => {
  const patientName = req.body.patient;
  const doctorName = req.body.doctor;
  const channelDate = req.body.channel_date;
  const channelTime = req.body.channel_time;

  // Step 1: Get doctor_id
  const getDoctorIdSQL = 'SELECT id FROM doctors WHERE name = ?';
  connection.query(getDoctorIdSQL, [doctorName], (err, doctorResults) => {
    if (err || doctorResults.length === 0) {
      return res.status(500).send('Doctor not found');
    }

    const doctorId = doctorResults[0].id;

    // Step 2: Check availability
    const getSlotSQL = `
      SELECT id FROM time_slots 
      WHERE doctor_id = ? AND slot_date = ? AND slot_time = ? AND is_booked = FALSE
    `;
    connection.query(getSlotSQL, [doctorId, channelDate, channelTime], (err, slotResults) => {
      if (err || slotResults.length === 0) {
        return res.status(400).send('Time slot is already booked or invalid');
      }

      const slotId = slotResults[0].id;

      // Step 3: Insert into appointments and mark slot as booked
      const insertAppointmentSQL = `
        INSERT INTO appointments (patient_name, doctor_id, slot_id)
        VALUES (?, ?, ?)
      `;
      connection.query(insertAppointmentSQL, [patientName, doctorId, slotId], (err) => {
        if (err) return res.status(500).send('Failed to book appointment');

        const updateSlotSQL = 'UPDATE time_slots SET is_booked = TRUE WHERE id = ?';
        connection.query(updateSlotSQL, [slotId], (err2) => {
          if (err2) return res.status(500).send('Slot booked, but update failed');

          res.send('✅ Appointment successfully booked!');
        });
      });
    });
  });
});

// ✅ Start the server
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
