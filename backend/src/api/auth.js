// backend/src/api/auth.js
import express from "express";
import jwt from "jsonwebtoken";
import bcryptjs from "bcryptjs";
import { User } from "../models/user.js";

const router = express.Router();
// Login endpoint
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValid = await bcryptjs.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username }, 
      process.env.JWT_SECRET,
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