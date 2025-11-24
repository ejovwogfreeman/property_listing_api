// server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const connectDB = require("./config/db");
const multer = require("multer");

// Import routes
const authRoutes = require("./routes/auth");
const propertyRoutes = require("./routes/property");
const chatRoutes = require("./routes/chat");
const notificationRoutes = require("./routes/notification");
// const escrowRoutes = require("./routes/escrow");

// Import socket handler
const socketHandler = require("./middlewares/socket");

// Initialize Express
const app = express();
const server = http.createServer(app);

// ------------------------
// Middleware
// ------------------------
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Multer setup for form-data (files + text)
const upload = multer();
// app.use(upload.none()); // Use in routes as needed

// ------------------------
// Connect MongoDB
// ------------------------
connectDB();

// ------------------------
// Test routes
// ------------------------
app.get("/", (req, res) => res.send("RealEstate Server is running 🚀"));
app.get("/api", (req, res) => res.send("RealEstate API is running 🚀"));

// ------------------------
// Mount API routes
// ------------------------
app.use("/api/auth", authRoutes);
app.use("/api/property", propertyRoutes);
app.use("/api/chat", chatRoutes);
// app.use("/api/notification", notificationRoutes);
// app.use("/api/escrow", escrowRoutes);

// ------------------------
// Socket.IO setup
// ------------------------
const io = new Server(server, { cors: { origin: "*" } });

// Global references for controllers
global.io = io;
global.onlineUsers = new Map();

// Initialize socket logic
socketHandler(io, global.onlineUsers);

// ------------------------
// Start server
// ------------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
