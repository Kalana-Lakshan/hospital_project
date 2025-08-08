const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware setup
app.use(session({
  secret: 'medsync-catms-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Serve static files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Database connection pool
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'catms_hospital',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test database connection
pool.getConnection()
  .then(connection => {
    console.log('Connected to CATMS Database');
    connection.release();
  })
  .catch(err => {
    console.error('Database connection error:', err);
  });

// Middleware to check login
function isLoggedIn(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized: Please log in' });
  }
  next();
}

// Middleware to check staff login
function isStaffLoggedIn(req, res, next) {
  if (!req.session.staffId) {
    return res.status(401).json({ error: 'Unauthorized: Staff access required' });
  }
  next();
}

// ======================
// AUTHENTICATION ROUTES
// ======================

// Patient Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email FROM patients WHERE email = ? AND password = ? AND is_active = TRUE',
      [email, password]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    req.session.userId = rows[0].id;
    req.session.userType = 'patient';
    res.json({ success: true, redirect: '/profile.html' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Staff Login
app.post('/staff-login', async (req, res) => {
  const { employee_id, password } = req.body;
  
  try {
    // For demo purposes, using simple password. In production, use bcrypt
    const [rows] = await pool.execute(
      `SELECT s.id, s.name, s.employee_id, s.role, s.branch_id, b.name as branch_name
       FROM staff s 
       JOIN branches b ON s.branch_id = b.id 
       WHERE s.employee_id = ? AND s.is_active = TRUE`,
      [employee_id]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid employee ID' });
    }
    
    req.session.staffId = rows[0].id;
    req.session.userType = 'staff';
    req.session.staffRole = rows[0].role;
    req.session.branchId = rows[0].branch_id;
    
    res.json({ 
      success: true, 
      redirect: rows[0].role === 'doctor' ? '/doctor-dashboard.html' : '/staff-dashboard.html'
    });
  } catch (error) {
    console.error('Staff login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Patient Registration
app.post('/register', async (req, res) => {
  const { name, email, password, phone, date_of_birth, gender, address, branch_id } = req.body;
  
  try {
    // Generate patient number
    const [countResult] = await pool.execute('SELECT COUNT(*) as count FROM patients');
    const patientNumber = `PAT${String(countResult[0].count + 1).padStart(4, '0')}`;
    
    const [result] = await pool.execute(
      `INSERT INTO patients (patient_number, name, email, password, phone, date_of_birth, 
       gender, address, registered_branch_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [patientNumber, name, email, password, phone, date_of_birth, gender, address, branch_id]
    );
    
    req.session.userId = result.insertId;
    req.session.userType = 'patient';
    res.json({ success: true, redirect: '/profile.html' });
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Email already registered' });
    } else {
      res.status(500).json({ error: 'Registration failed' });
    }
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// ======================
// PATIENT API ROUTES
// ======================

// Get session user data
app.get('/session-data', isLoggedIn, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT name, email, phone, patient_number FROM patients WHERE id = ?',
      [req.session.userId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('Session data error:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// Get branches
app.get('/branches', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, name, location FROM branches ORDER BY name');
    res.json(rows);
  } catch (error) {
    console.error('Branches fetch error:', error);
    res.status(500).json([]);
  }
});

// Get doctors by branch
app.get('/doctors', async (req, res) => {
  const { branch_id } = req.query;
  
  try {
    let query = `
      SELECT s.id, s.name, s.employee_id, 
             GROUP_CONCAT(sp.name SEPARATOR ', ') as specialties
      FROM staff s
      LEFT JOIN doctor_specialties ds ON s.id = ds.doctor_id
      LEFT JOIN specialties sp ON ds.specialty_id = sp.id
      WHERE s.role = 'doctor' AND s.is_active = TRUE
    `;
    let params = [];
    
    if (branch_id) {
      query += ' AND s.branch_id = ?';
      params.push(branch_id);
    }
    
    query += ' GROUP BY s.id ORDER BY s.name';
    
    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Doctors fetch error:', error);
    res.status(500).json([]);
  }
});

// Get available time slots
app.get('/available-slots', async (req, res) => {
  const { doctorId, date } = req.query;
  
  if (!doctorId || !date) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  
  try {
    const [rows] = await pool.execute(
      `SELECT id, slot_time, duration_minutes 
       FROM time_slots 
       WHERE doctor_id = ? AND slot_date = ? AND is_available = TRUE
       ORDER BY slot_time`,
      [doctorId, date]
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Slots fetch error:', error);
    res.status(500).json([]);
  }
});

// Book appointment
app.post('/book-appointment', isLoggedIn, async (req, res) => {
  const patientId = req.session.userId;
  const { doctor_id, slot_id, appointment_type = 'scheduled' } = req.body;
  
  if (!doctor_id || !slot_id) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Check slot availability
    const [slotCheck] = await connection.execute(
      'SELECT is_available, doctor_id FROM time_slots WHERE id = ?',
      [slot_id]
    );
    
    if (slotCheck.length === 0 || !slotCheck[0].is_available) {
      await connection.rollback();
      return res.status(400).json({ error: 'Time slot not available' });
    }
    
    if (slotCheck[0].doctor_id !== parseInt(doctor_id)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Invalid doctor-slot combination' });
    }
    
    // Get doctor's branch for appointment number generation
    const [doctorInfo] = await connection.execute(
      'SELECT branch_id FROM staff WHERE id = ?',
      [doctor_id]
    );
    
    // Generate appointment number
    const [branchInfo] = await connection.execute(
      'SELECT name FROM branches WHERE id = ?',
      [doctorInfo[0].branch_id]
    );
    
    const branchCode = branchInfo[0].name.substring(0, 3).toUpperCase();
    const dateCode = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    
    const [countResult] = await connection.execute(
      'SELECT COUNT(*) as count FROM appointments WHERE DATE(created_at) = CURDATE()'
    );
    
    const appointmentNumber = `${branchCode}${dateCode}${String(countResult[0].count + 1).padStart(4, '0')}`;
    
    // Insert appointment
    const [appointmentResult] = await connection.execute(
      `INSERT INTO appointments (appointment_number, patient_id, doctor_id, slot_id, appointment_type) 
       VALUES (?, ?, ?, ?, ?)`,
      [appointmentNumber, patientId, doctor_id, slot_id, appointment_type]
    );
    
    await connection.commit();
    res.json({ 
      success: true, 
      message: 'Appointment booked successfully!',
      appointmentNumber: appointmentNumber
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Appointment booking error:', error);
    res.status(500).json({ error: 'Failed to book appointment' });
  } finally {
    connection.release();
  }
});

// Get patient appointments
app.get('/my-appointments', isLoggedIn, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.appointment_number, a.status, a.appointment_type,
              s.name as doctor_name, ts.slot_date, ts.slot_time,
              GROUP_CONCAT(sp.name SEPARATOR ', ') as doctor_specialties,
              b.name as branch_name
       FROM appointments a
       JOIN staff s ON a.doctor_id = s.id
       JOIN time_slots ts ON a.slot_id = ts.id
       JOIN branches b ON s.branch_id = b.id
       LEFT JOIN doctor_specialties ds ON s.id = ds.doctor_id
       LEFT JOIN specialties sp ON ds.specialty_id = sp.id
       WHERE a.patient_id = ?
       GROUP BY a.id
       ORDER BY ts.slot_date DESC, ts.slot_time DESC`,
      [req.session.userId]
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Appointments fetch error:', error);
    res.status(500).json([]);
  }
});

// ======================
// STAFF/DOCTOR ROUTES
// ======================

// Get staff session data
app.get('/staff-session-data', isStaffLoggedIn, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT s.name, s.employee_id, s.role, s.email, s.phone,
              b.name as branch_name
       FROM staff s
       JOIN branches b ON s.branch_id = b.id
       WHERE s.id = ?`,
      [req.session.staffId]
    );
    
    res.json(rows[0] || {});
  } catch (error) {
    console.error('Staff session data error:', error);
    res.status(500).json({});
  }
});

// Get doctor's appointments
app.get('/doctor-appointments', isStaffLoggedIn, async (req, res) => {
  const { date } = req.query;
  
  try {
    let query = `
      SELECT a.id, a.appointment_number, a.status, a.appointment_type,
             p.name as patient_name, p.phone as patient_phone,
             ts.slot_time, ts.slot_date
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN time_slots ts ON a.slot_id = ts.id
      WHERE a.doctor_id = ?
    `;
    let params = [req.session.staffId];
    
    if (date) {
      query += ' AND ts.slot_date = ?';
      params.push(date);
    }
    
    query += ' ORDER BY ts.slot_date DESC, ts.slot_time DESC';
    
    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Doctor appointments fetch error:', error);
    res.status(500).json([]);
  }
});

// Update appointment status
app.put('/appointments/:id/status', isStaffLoggedIn, async (req, res) => {
  const { id } = req.params;
  const { status, consultation_notes, diagnosis } = req.body;
  
  try {
    let query = 'UPDATE appointments SET status = ?';
    let params = [status];
    
    if (status === 'completed') {
      query += ', consultation_notes = ?, diagnosis = ?, completed_at = NOW()';
      params.push(consultation_notes || '', diagnosis || '');
    } else if (status === 'cancelled') {
      query += ', cancelled_at = NOW()';
    }
    
    query += ' WHERE id = ? AND doctor_id = ?';
    params.push(id, req.session.staffId);
    
    await pool.execute(query, params);
    res.json({ success: true, message: 'Appointment updated successfully' });
  } catch (error) {
    console.error('Appointment update error:', error);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// ======================
// REPORTS ROUTES
// ======================

// Branch appointment summary
app.get('/reports/branch-summary', isStaffLoggedIn, async (req, res) => {
  const { date } = req.query;
  
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM vw_branch_appointment_summary 
       WHERE appointment_date = ? OR ? IS NULL
       ORDER BY branch_name, appointment_date DESC`,
      [date, date]
    );
    
    res.json(rows);
  } catch (error) {
    console.error('Branch summary error:', error);
    res.status(500).json([]);
  }
});

// Doctor revenue report
app.get('/reports/doctor-revenue', isStaffLoggedIn, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM vw_doctor_revenue ORDER BY gross_revenue DESC');
    res.json(rows);
  } catch (error) {
    console.error('Doctor revenue error:', error);
    res.status(500).json([]);
  }
});

// Patients with outstanding balance
app.get('/reports/outstanding-balance', isStaffLoggedIn, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM vw_patients_outstanding ORDER BY total_outstanding DESC');
    res.json(rows);
  } catch (error) {
    console.error('Outstanding balance error:', error);
    res.status(500).json([]);
  }
});

// ======================
// PROTECTED ROUTES
// ======================

// Serve protected HTML pages
app.get('/profile.html', isLoggedIn, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/book-appointment.html', isLoggedIn, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'book-appointment.html'));
});

app.get('/doctor-dashboard.html', isStaffLoggedIn, (req, res) => {
  if (req.session.staffRole !== 'doctor') {
    return res.redirect('/staff-dashboard.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'doctor-dashboard.html'));
});

app.get('/staff-dashboard.html', isStaffLoggedIn, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'staff-dashboard.html'));
});

// ======================
// DEFAULT ROUTES
// ======================

// Root route
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Start server
app.listen(port, () => {
  console.log(`CATMS Server running on http://localhost:${port}`);
  console.log('Access the application at: http://localhost:3000/login.html');
});