const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5002;

// Enable CORS
app.use(cors());

// Increase the request size limit
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME || 'dvujewnzv',
  api_key: process.env.API_KEY || '574286298287138',
  api_secret: process.env.API_SECRET || 'QZdXJJvkw_KIQXkq6u_kY8lgH4Y',
  timeout: 60000
});

// Configure Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase URL or Key missing in .env file');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================
// Encryption Functions
// ============================================================
const algorithm = 'aes-256-cbc';
const secretKey = crypto
  .createHash('sha256')
  .update(String(process.env.SECRET_KEY || 'default_secret'))
  .digest()
  .slice(0, 32);
const fixedIV = Buffer.alloc(16, 0);

function encrypt(text) {
  const cipher = crypto.createCipheriv(algorithm, secretKey, fixedIV);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decrypt(encrypted) {
  try {
    const decipher = crypto.createDecipheriv(algorithm, secretKey, fixedIV);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return encrypted; // Return original if decryption fails
  }
}
// ============================================================

// Helper to map Supabase row to expected API format
const mapStudent = (row) => ({
  _id: row.id, // Map Supabase 'id' to '_id' for frontend compatibility
  name: row.name,
  studentId: row.student_id,
  email: row.email,
  course: row.course,
  year: row.year,
  image: row.image,
  cloudinaryId: row.cloudinary_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

// Set up multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Not an image! Please upload only images.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.use('/uploads', express.static('uploads'));

function logEvent(type, message, details = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${type.toUpperCase()}] ${timestamp}: ${message}`, details);
}

// Routes

app.post('/add-student', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      logEvent('error', 'No image uploaded');
      return res.status(400).json({ message: '⚠️ No image uploaded' });
    }

    const uploadOptions = {
      folder: 'data_entry_app',
      use_filename: true,
      resource_type: 'auto',
      timeout: 60000
    };
    const result = await cloudinary.uploader.upload(req.file.path, uploadOptions);

    fs.unlinkSync(req.file.path);

    const { name, studentId, email, course, year } = req.body;

    const missingFields = [];
    if (!name) missingFields.push('Name');
    if (!studentId) missingFields.push('Student ID');
    if (!email) missingFields.push('Email');
    if (!course) missingFields.push('Course');
    if (!year) missingFields.push('Year');

    if (missingFields.length > 0) {
      logEvent('error', 'Missing required fields', { missingFields });
      return res.status(400).json({
        message: `Missing required fields: ${missingFields.join(', ')}`,
        missingFields
      });
    }

    const encryptedName = encrypt(name);
    const encryptedStudentId = encrypt(studentId);
    const encryptedEmail = encrypt(email);

    const { data, error } = await supabase
      .from('students')
      .insert([
        {
          name: encryptedName,
          student_id: encryptedStudentId,
          email: encryptedEmail,
          course,
          year: Number(year),
          image: result.secure_url,
          cloudinary_id: result.public_id
        }
      ])
      .select();

    if (error) {
      throw error;
    }

    const newStudent = mapStudent(data[0]);
    logEvent('success', 'Student added successfully', { studentId: newStudent._id });

    res.status(201).json({
      message: '✅ Student added successfully',
      student: newStudent
    });

  } catch (error) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    // Handle unique constraint violation
    if (error.code === '23505') { // Postgres unique violation
      logEvent('error', 'Duplicate entry', { error: error.message });
      return res.status(409).json({
        message: '❌ Student ID or Email already exists',
        error: error.message
      });
    }

    logEvent('error', 'Error adding student', { error: error.message });
    res.status(500).json({
      message: '❌ Error adding student',
      error: error.message
    });
  }
});

app.put('/update-student/:id', upload.none(), async (req, res) => {
  try {
    const { name, studentId, email, course, year, image } = req.body;
    const { id } = req.params;

    const updates = {};
    if (name) updates.name = encrypt(name);
    if (studentId) updates.student_id = encrypt(studentId);
    if (email) updates.email = encrypt(email);
    if (course) updates.course = course;
    if (year) updates.year = Number(year);
    if (image) updates.image = image;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('students')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      logEvent('warning', 'Student not found for update', { id });
      return res.status(404).json({ message: '⚠️ Student not found' });
    }

    const updatedStudent = mapStudent(data[0]);
    logEvent('success', 'Student updated successfully', { studentId: updatedStudent._id });

    res.json({
      message: '✅ Student updated successfully',
      student: updatedStudent
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        message: '❌ Student ID or Email already exists',
        error: error.message
      });
    }
    logEvent('error', 'Error updating student', { error: error.message });
    res.status(500).json({
      message: '❌ Error updating student',
      error: error.message
    });
  }
});

app.delete('/delete-student/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('students')
      .delete()
      .eq('id', id)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      logEvent('warning', 'Student not found for deletion', { id });
      return res.status(404).json({ message: '⚠️ Student not found' });
    }

    logEvent('success', 'Student deleted successfully', { studentId: id });
    res.json({ message: '✅ Student deleted successfully' });
  } catch (error) {
    logEvent('error', 'Error deleting student', { error: error.message });
    res.status(500).json({
      message: '❌ Error deleting student',
      error: error.message
    });
  }
});

app.get('/get-students', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const students = data.map(mapStudent);
    logEvent('success', 'Retrieved all students', { count: students.length });
    res.json(students);
  } catch (error) {
    logEvent('error', 'Error fetching students', { error: error.message });
    res.status(500).json({
      message: '❌ Error fetching students',
      error: error.message
    });
  }
});

app.get('/get-student/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ message: '⚠️ Student not found' });
    }

    const student = mapStudent(data);
    logEvent('success', 'Retrieved student details', { studentId: student._id });
    res.json(student);
  } catch (error) {
    logEvent('error', 'Error fetching student', { error: error.message });
    res.status(500).json({
      message: '❌ Error fetching student',
      error: error.message
    });
  }
});

app.post('/login', async (req, res) => {
  const { email, studentId } = req.body;

  if (!email || !studentId) {
    return res.status(400).json({ message: 'Email and Student ID are required' });
  }

  try {
    const encryptedEmail = encrypt(email);
    const encryptedStudentId = encrypt(studentId);

    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('email', encryptedEmail)
      .eq('student_id', encryptedStudentId)
      .single();

    if (error || !data) {
      return res.status(401).json({ message: 'Invalid email or student ID' });
    }

    res.json({
      studentId: decrypt(data.student_id),
      name: decrypt(data.name),
      email: decrypt(data.email),
      image: data.image
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      message: 'An error occurred during login',
      error: error.message
    });
  }
});

app.use((err, req, res, next) => {
  logEvent('critical', 'Unhandled server error', { error: err.message });
  res.status(500).json({
    message: '❌ Unexpected server error',
    error: err.message
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
