// backend/src/api/auth.js
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import db from "../db.js";

const router = express.Router();

// Initialize users table
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Create default admin user if none exists
const existingUser = db.prepare("SELECT * FROM users LIMIT 1").get();
if (!existingUser) {
  const hashedPassword = await bcrypt.hash("admin", 10);
  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run("admin", hashedPassword);
  console.log("🔧 Default admin user created (username: admin, password: admin)");
}

// Login endpoint
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username }, 
      process.env.JWT_SECRET || "supersecret",
      { expiresIn: "24h" }
    );

    res.json({ 
      success: true, 
      token,
      user: { id: user.id, username: user.username }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify token endpoint
router.get("/verify", (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "supersecret");
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
});

// Change password endpoint
router.post("/change-password", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  const { currentPassword, newPassword } = req.body;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "supersecret");
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(decoded.id);
    
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: "Current password incorrect" });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(hashedNewPassword, decoded.id);

    res.json({ success: true, message: "Password updated" });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;