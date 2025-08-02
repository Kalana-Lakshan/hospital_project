const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const app = express();
const port = 3000;

// Middleware to parse form data
app.use(express.urlencoded({ extended: true }));

// ✅ Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// ✅ MySQL connection setup
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',              // Your MySQL user
  password: '',              // Your MySQL password
  database: 'hospital'    // Your DB name
});

connection.connect((err) => {
  if (err) {
    console.error('MySQL connection error:', err);
    return;
  }
  console.log('Connected to MySQL database');
});

// ✅ Handle form submission from channeling.html
app.post('/channeling', (req, res) => {
  const patientName = req.body.patient;
  const doctorName = req.body.doctor;
  const channelDate = req.body.channel_date;
  const channelTime = req.body.channel_time;

  const sql = `INSERT INTO appointments (Patient_Name, Doctor_Name, Date, Time) VALUES (?, ?, ?, ?)`;

  connection.query(sql, [patientName, doctorName, channelDate, channelTime], (err, result) => {
    if (err) {
      console.error('Insert error:', err);
      return res.status(500).send('Error saving channeling info');
    }
    res.send('Channeling info saved successfully!');
    // OR: res.redirect('/success.html'); if you have a success page
  });
});

// ✅ Start server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
